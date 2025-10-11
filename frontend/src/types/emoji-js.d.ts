declare module 'emoji-js' {
  export default class EmojiConvertor {
    allow_native: boolean;
    replace_mode: string;
    replace_colons(input: string): string;
  }
}
