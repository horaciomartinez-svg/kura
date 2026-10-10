// Tipado mínimo de mjml-browser (compilación MJML -> HTML en el cliente, §9.4).
declare module 'mjml-browser' {
  interface MjmlResult {
    html: string
    errors: unknown[]
    json?: unknown
  }

  interface MjmlOptions {
    beautify?: boolean
    minify?: boolean
    keepComments?: boolean
    validationLevel?: 'strict' | 'soft' | 'skip'
  }

  export default function mjml2html(input: string, options?: MjmlOptions): MjmlResult
}
