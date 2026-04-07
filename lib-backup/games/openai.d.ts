export declare function initOpenAI(): boolean;
export declare function callOpenAI(systemPrompt: string, userPrompt: string): Promise<string>;
export declare function callOpenAIJson(systemPrompt: string, userPrompt: string): Promise<any>;
