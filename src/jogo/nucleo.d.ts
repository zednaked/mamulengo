// o nucleo em wasm (nucleo/build-web/nucleo.mjs, gerado pelo emscripten): o tools/exportar-jogo.ts
// resolve este nome para o arquivo de verdade ao empacotar o tocador
declare module "mamulengo-nucleo" {
  const fabrica: (opcoes: { wasmBinary?: Uint8Array }) => Promise<any>;
  export default fabrica;
}
