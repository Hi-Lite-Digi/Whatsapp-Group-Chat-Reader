#!/usr/bin/env bash
set -euo pipefail

: "${RELEASE_ID:?RELEASE_ID is required}"
: "${SOURCE_ARCHIVE:?SOURCE_ARCHIVE is required}"

REGION=ap-southeast-1
STACK_NAME=hilite-prod-whatsapp-listener
BUCKET=hilite-prod-deploy-artifacts-824865425772-ap-southeast-1
KMS_KEY_ARN=arn:aws:kms:ap-southeast-1:824865425772:key/2d489a9b-b420-466c-8d02-a81111386b6a
SOURCE_KEY="whatsapp-listener/source/$RELEASE_ID/source.tgz"
DEPLOY_KEY="whatsapp-listener/deploy/$RELEASE_ID/install-release.sh"

aws s3 cp "$SOURCE_ARCHIVE" "s3://$BUCKET/$SOURCE_KEY" \
  --region "$REGION" --sse aws:kms --sse-kms-key-id "$KMS_KEY_ARN"
aws s3 cp deploy/aws/install-release.sh "s3://$BUCKET/$DEPLOY_KEY" \
  --region "$REGION" --sse aws:kms --sse-kms-key-id "$KMS_KEY_ARN"

# Application releases must not update the singleton infrastructure stack.
# Re-resolving the "latest AMI" parameter can replace the protected instance,
# while the persistent data volume is still attached to the live singleton.
# Create the stack when absent, or update it only during an explicitly reviewed
# infrastructure change.
if ! aws cloudformation describe-stacks \
  --region "$REGION" \
  --stack-name "$STACK_NAME" >/dev/null 2>&1; then
  UPDATE_INFRASTRUCTURE=true
fi

if [ "${UPDATE_INFRASTRUCTURE:-false}" = true ]; then
  aws cloudformation deploy \
    --region "$REGION" \
    --stack-name "$STACK_NAME" \
    --template-file deploy/aws/hilite-dedicated-stack.yaml \
    --capabilities CAPABILITY_NAMED_IAM \
    --parameter-overrides \
      "SourceArchiveUri=s3://$BUCKET/$SOURCE_KEY" \
      "ImageTag=$RELEASE_ID" \
    --tags Environment=production Service=whatsapp-listener
else
  printf 'Using existing stack %s; application-only release will not replace infrastructure.\n' "$STACK_NAME"
fi

BUILD_PROJECT=$(aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='ImageBuildProjectName'].OutputValue" --output text)
BUILD_ID=$(aws codebuild start-build --region "$REGION" --project-name "$BUILD_PROJECT" \
  --environment-variables-override \
    "name=SOURCE_S3_URI,value=s3://$BUCKET/$SOURCE_KEY,type=PLAINTEXT" \
    "name=IMAGE_TAG,value=$RELEASE_ID,type=PLAINTEXT" \
  --query build.id --output text)

while true; do
  BUILD_STATUS=$(aws codebuild batch-get-builds --region "$REGION" --ids "$BUILD_ID" \
    --query 'builds[0].buildStatus' --output text)
  case "$BUILD_STATUS" in
    SUCCEEDED) break ;;
    FAILED|FAULT|STOPPED|TIMED_OUT) printf 'Image build failed: %s\n' "$BUILD_STATUS" >&2; exit 1 ;;
    *) sleep 10 ;;
  esac
done

INSTANCE_ID=$(aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='InstanceId'].OutputValue" --output text)
SECRET_ARN=$(aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='SecretArn'].OutputValue" --output text)
REPOSITORY_URI=$(aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='RepositoryUri'].OutputValue" --output text)
LOG_GROUP_NAME=$(aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='LogGroupName'].OutputValue" --output text)

PARAMETERS=$(jq -nc \
  --arg bucket "$BUCKET" \
  --arg deploy_key "$DEPLOY_KEY" \
  --arg image_uri "$REPOSITORY_URI:$RELEASE_ID" \
  --arg secret_arn "$SECRET_ARN" \
  --arg log_group "$LOG_GROUP_NAME" \
  --arg kms_key "$KMS_KEY_ARN" \
  '{commands:[
    "set -euo pipefail",
    ("aws s3 cp s3://"+$bucket+"/"+$deploy_key+" /tmp/install-release.sh --region ap-southeast-1 --only-show-errors"),
    "chmod 700 /tmp/install-release.sh",
    ("IMAGE_URI="+($image_uri|@sh)+" SECRET_ARN="+($secret_arn|@sh)+" LOG_GROUP_NAME="+($log_group|@sh)+" ARTIFACT_BUCKET="+($bucket|@sh)+" KMS_KEY_ARN="+($kms_key|@sh)+" DASHBOARD_DOMAIN=whatsapp.hilitedigi.ai AWS_REGION=ap-southeast-1 /tmp/install-release.sh")
  ]}')

COMMAND_ID=$(aws ssm send-command --region "$REGION" --instance-ids "$INSTANCE_ID" \
  --document-name AWS-RunShellScript --comment "Deploy WhatsApp listener $RELEASE_ID" \
  --parameters "$PARAMETERS" --query Command.CommandId --output text)
aws ssm wait command-executed --region "$REGION" --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID"
aws ssm get-command-invocation --region "$REGION" --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" \
  --query '{Status:Status,Output:StandardOutputContent,Errors:StandardErrorContent}' --output json

printf 'STACK_NAME=%s\n' "$STACK_NAME"
printf 'INSTANCE_ID=%s\n' "$INSTANCE_ID"
printf 'IMAGE_URI=%s:%s\n' "$REPOSITORY_URI" "$RELEASE_ID"
printf 'SSM_COMMAND_ID=%s\n' "$COMMAND_ID"
