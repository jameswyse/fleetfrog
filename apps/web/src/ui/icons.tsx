import type { SVGProps } from "react";

/** A 24-unit line icon drawn with the current text colour. Always decorative: label its control. */
function Icon({ children, className = "size-4", ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      {...props}
    >
      {children}
    </svg>
  );
}

type IconProps = { readonly className?: string };

export function ScanIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M3 12a9 9 0 0 1 15.4-6.4L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15.4 6.4L3 16" />
      <path d="M8 16H3v5" />
    </Icon>
  );
}

export function FleetIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="m12 3 9 4.5-9 4.5-9-4.5Z" />
      <path d="m3 12 9 4.5 9-4.5" />
      <path d="m3 16.5 9 4.5 9-4.5" />
    </Icon>
  );
}

export function MachineIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <rect x="2.5" y="3.5" width="19" height="13" rx="2" />
      <path d="M8 20.5h8" />
      <path d="M12 16.5v4" />
    </Icon>
  );
}

export function PlusIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </Icon>
  );
}

export function BackIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M19 12H5" />
      <path d="m11 18-6-6 6-6" />
    </Icon>
  );
}

export function ChevronIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="m9 6 6 6-6 6" />
    </Icon>
  );
}

export function FolderIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M3.5 6.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z" />
    </Icon>
  );
}

export function CloseIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </Icon>
  );
}

export function RunningIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="m10 8.5 5 3.5-5 3.5Z" />
    </Icon>
  );
}

export function HistoryIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M3 12a9 9 0 1 0 2.64-6.36L3 8.3" />
      <path d="M3 3.5v4.8h4.8" />
      <path d="M12 7.5V12l3 2" />
    </Icon>
  );
}
