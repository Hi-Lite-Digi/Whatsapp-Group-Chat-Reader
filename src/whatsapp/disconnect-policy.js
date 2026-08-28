export function getDisconnectPolicy(statusCode, disconnectReason) {
  const isRestartRequired = statusCode === disconnectReason.restartRequired;
  const isLoggedOut = statusCode === disconnectReason.loggedOut;
  const isConflict = statusCode === 440
    || statusCode === disconnectReason.connectionReplaced
    || isLoggedOut;

  return {
    isRestartRequired,
    isRateLimited: statusCode === 429,
    shouldReconnect: isRestartRequired || (!isLoggedOut && !isConflict)
  };
}
