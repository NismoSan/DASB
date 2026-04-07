export declare class ShuffleDeck<T> {
    private _get;
    private _deck;
    constructor(sourceArrayGetter: () => T[]);
    private _refill;
    draw(): T | null;
    reset(): void;
}
export interface TriviaItem {
    question: string;
    answer: string;
    hint: string;
}
export interface RiddleItem {
    riddle: string;
    answer: string;
    hint: string;
}
export interface WordItem {
    word: string;
    hint: string;
}
export declare const FALLBACK_TRIVIA: TriviaItem[];
export declare const FALLBACK_RIDDLES: RiddleItem[];
export declare const FALLBACK_WORDS: WordItem[];
export declare function generateTrivia(charLimit: number, callback: (err: any, data: {
    question: string;
    answer: string;
    hint: string;
}) => void): void;
export declare function generateRiddle(charLimit: number, callback: (err: any, data: {
    question: string;
    answer: string;
    hint: string;
}) => void): void;
export declare function generateHangman(callback: (err: any, data: {
    question: string;
    answer: string;
    hint: string;
    guessedLetters: string[];
    wrongCount: number;
    maxWrong: number;
    maxAttempts: number;
}) => void): void;
export declare function generateScramble(callback: (err: any, data: {
    question: string;
    answer: string;
    hint: string;
}) => void): void;
export declare function generateNumberGuess(): {
    targetNumber: number;
    answer: string;
    hint: string;
};
export declare function scrambleWord(word: string): string;
export declare function buildRevealedWord(word: string, guessedLetters: string[]): string;
export declare function sanitizeName(name: string): string;
export declare function resetCustomDecks(): void;
