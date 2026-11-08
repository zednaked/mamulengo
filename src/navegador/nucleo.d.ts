// o modulo do nucleo gerado pelo emscripten (nucleo/build-web/nucleo.mjs), pelo apelido do
// vite.navegador.config.ts
declare module "@mamulengo/nucleo" {
  const criar: (opcoes?: { locateFile?: (arquivo: string) => string }) => Promise<any>;
  export default criar;
}
