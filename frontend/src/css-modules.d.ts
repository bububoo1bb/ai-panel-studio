/**
 * Type declaration for CSS Modules (*.module.css imports).
 * Enables typed className access in TypeScript components.
 */
declare module "*.module.css" {
  const classes: { readonly [key: string]: string };
  export default classes;
}
