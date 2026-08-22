import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';
import { getSettings } from '../db/database.js';

export async function processMessageWithLLM({
  content = '',
  extractedText = '',
  media = null,
  schema,
  senderInfo = {}
}) {
  const settings = getSettings();
  const provider = settings.llm_provider || 'gemini';
  const modelName = settings.llm_model || 'gemini-2.0-flash';

  const systemPrompt = `You are an automated real-time data extraction system for WhatsApp group chat messages.
Your task is to analyze the message content (and any attached media or extracted document text) and extract structured data according to the target JSON schema below.

TARGET SCHEMA NAME: "${schema.name}"
EXTRACTION INSTRUCTIONS:
${schema.instruction_prompt}

EXPECTED OUTPUT FORMAT (JSON SCHEMA / STRUCTURE):
${schema.json_schema}

CRITICAL RULES:
1. Output MUST be valid JSON only. Do not include extra conversational text outside the JSON object.
2. If the message does not contain information relevant to a field, set the value to null or appropriate empty type.
3. Be precise, accurate, and concise.`;

  let userText = `--- WHATSAPP MESSAGE METADATA ---
Group: ${senderInfo.groupName || 'Unknown Group'}
Sender: ${senderInfo.name || 'Unknown Sender'} (${senderInfo.id || 'N/A'})

--- MESSAGE CONTENT ---
Text / Caption: ${content || '[No text content]'}
`;

  if (extractedText) {
    userText += `\n--- EXTRACTED DOCUMENT TEXT ---\n${extractedText}\n`;
  }

  let rawResultText = '';

  try {
    if (provider === 'gemini') {
      const apiKey = settings.gemini_api_key || process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error('Gemini API key is missing in settings');

      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({
        model: modelName.includes('gemini') ? modelName : 'gemini-2.0-flash',
        generationConfig: { responseMimeType: 'application/json' }
      });

      const parts = [{ text: systemPrompt + '\n\n' + userText }];

      if (media && media.mimetype && media.mimetype.startsWith('image/') && media.base64) {
        parts.push({
          inlineData: {
            mimeType: media.mimetype,
            data: media.base64
          }
        });
      }

      const res = await model.generateContent(parts);
      rawResultText = res.response.text();
    } else if (provider === 'openai') {
      const apiKey = settings.openai_api_key || process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error('OpenAI API key is missing in settings');

      const openai = new OpenAI({ apiKey });
      const userContent = [{ type: 'text', text: userText }];

      if (media && media.mimetype && media.mimetype.startsWith('image/') && media.base64) {
        userContent.push({
          type: 'image_url',
          image_url: {
            url: `data:${media.mimetype};base64,${media.base64}`
          }
        });
      }

      const response = await openai.chat.completions.create({
        model: modelName || 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent }
        ]
      });

      rawResultText = response.choices[0].message.content;
    } else if (provider === 'anthropic') {
      const apiKey = settings.anthropic_api_key || process.env.ANTHROPIC_API_KEY;
      if (!apiKey) throw new Error('Anthropic API key is missing in settings');

      const anthropic = new Anthropic({ apiKey });
      const contentBlocks = [{ type: 'text', text: userText }];

      if (media && media.mimetype && media.mimetype.startsWith('image/') && media.base64) {
        contentBlocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: media.mimetype,
            data: media.base64
          }
        });
      }

      const response = await anthropic.messages.create({
        model: modelName || 'claude-3-5-sonnet-20241022',
        max_tokens: 2000,
        system: systemPrompt,
        messages: [{ role: 'user', content: contentBlocks }]
      });

      rawResultText = response.content[0].text;
    } else if (provider === 'ollama') {
      const baseUrl = settings.ollama_base_url || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
      
      const payload = {
        model: modelName || 'llama3',
        prompt: `${systemPrompt}\n\n${userText}`,
        format: 'json',
        stream: false
      };

      if (media && media.mimetype && media.mimetype.startsWith('image/') && media.base64) {
        payload.images = [media.base64];
      }

      const response = await axios.post(`${baseUrl}/api/generate`, payload);
      rawResultText = response.data.response;
    } else {
      throw new Error(`Unsupported LLM provider: ${provider}`);
    }

    // Clean & parse JSON output
    const parsedData = cleanAndParseJSON(rawResultText);
    return {
      provider,
      model: modelName,
      extractedData: parsedData,
      rawOutput: rawResultText,
      status: 'success'
    };
  } catch (err) {
    console.error(`LLM Extraction Error (${provider}/${modelName}):`, err.message);
    return {
      provider,
      model: modelName,
      extractedData: null,
      rawOutput: rawResultText,
      status: 'failed',
      error: err.message
    };
  }
}

function cleanAndParseJSON(text) {
  if (!text) return {};
  let cleaned = text.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.replace(/^```json/, '').replace(/```$/, '').trim();
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```/, '').replace(/```$/, '').trim();
  }

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    console.warn('JSON direct parse failed, extracting substring:', e.message);
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      const jsonSub = cleaned.substring(firstBrace, lastBrace + 1);
      return JSON.parse(jsonSub);
    }
    return { unparsed_raw_text: text };
  }
}
