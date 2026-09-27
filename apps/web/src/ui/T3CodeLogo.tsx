import logo from "./t3-code-logo.png";

/**
 * T3 Code's app icon, from its own app at 32 pixels so it stays sharp at 16. The icon remains T3
 * Code's trademark, used here only to name it. Decorative: its name belongs beside it.
 */
export function T3CodeLogo() {
  return <img alt="" src={logo} width={16} height={16} className="size-4 shrink-0 rounded-[4px]" />;
}
