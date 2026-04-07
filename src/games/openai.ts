// -- OpenAI Helpers -------------------------------------------------------
import OpenAI from 'openai';
import S from './state';

export function initOpenAI(): boolean {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    S.openaiClient = null;
    return false;
  }
  S.openaiClient = new OpenAI({ apiKey: apiKey, timeout: 15000 });
  return true;
}

export function callOpenAI(systemPrompt: string, userPrompt: string): Promise<string> {
  if (!S.openaiClient) {
    return Promise.reject(new Error('OpenAI not initialized'));
  }

  const now = Date.now();
  const delay = Math.max(0, S.MIN_OPENAI_INTERVAL - (now - S.lastOpenAICall));

  return new Promise<void>(function (resolve) {
    setTimeout(resolve, delay);
  }).then(function () {
    S.lastOpenAICall = Date.now();
    return S.openaiClient.chat.completions.create({
      model: S.config.openaiModel || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: 150,
      temperature: 0.8
    });
  }).then(function (response: any) {
    return response.choices[0].message.content.trim();
  });
}

export function callOpenAIJson(systemPrompt: string, userPrompt: string): Promise<any> {
  return callOpenAI(systemPrompt, userPrompt).then(function (text: string) {
    text = text.replace(/^```json\s*\n?/, '').replace(/\n?\s*```$/, '');
    return JSON.parse(text);
  });
}
