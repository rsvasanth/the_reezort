/// <reference types="nativewind/types" />

/**
 * `global.css` is imported for its side effects — Metro's NativeWind transformer
 * turns it into the style registry. TypeScript needs to be told the module
 * exists; there is nothing to type.
 */
declare module "*.css";
