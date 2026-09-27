import { FolderGit2Icon } from "lucide-react";
import { DynamicIcon, iconNames } from "lucide-react/dynamic";

import { ProjectIcon as IconSchema } from "@fleetfrog/protocol/domain/t3Code";

import type { IconName } from "lucide-react/dynamic";

import type { ProjectIcon as Icon, ProjectIconColor } from "@fleetfrog/protocol/domain/t3Code";

const knownNames: ReadonlySet<string> = new Set(iconNames);

function isIconName(name: string): name is IconName {
  return knownNames.has(name);
}

/** Holds the icon's place while its drawing loads, so the name beside it doesn't move. */
function Placeholder() {
  return <span aria-hidden="true" className="size-4 shrink-0" />;
}

/**
 * Two characters on a tint of their colour, drawn as T3 Code draws them so a pair always fits the
 * same square.
 */
function Monogram({ text, color }: { readonly text: string; readonly color: ProjectIconColor }) {
  const characters = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)];

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="size-4 shrink-0 overflow-hidden rounded-[25%] font-mono select-none"
      style={{
        color: `var(--project-${color})`,
        backgroundColor: "color-mix(in srgb, currentColor 14%, transparent)",
      }}
    >
      <text
        x="8"
        y="10.8"
        textAnchor="middle"
        fill="currentColor"
        fontSize="8.25"
        fontWeight="700"
        textLength={characters.length === 1 ? 6 : 12}
        lengthAdjust="spacingAndGlyphs"
        textRendering="geometricPrecision"
      >
        {text}
      </text>
    </svg>
  );
}

/** A project's icon from T3 Code. Decorative: the project's name belongs beside it. */
export function ProjectIcon({ icon }: { readonly icon: Icon }) {
  return IconSchema.match(icon, {
    Lucide: ({ name, color }) =>
      isIconName(name) ? (
        <DynamicIcon
          aria-hidden="true"
          name={name}
          fallback={Placeholder}
          style={{ color: `var(--project-${color})` }}
        />
      ) : (
        // A newer T3 Code may offer icons this dashboard's Lucide lacks.
        <FolderGit2Icon aria-hidden="true" style={{ color: `var(--project-${color})` }} />
      ),
    Emoji: ({ emoji }) => (
      <span
        aria-hidden="true"
        className="flex size-4 shrink-0 items-center justify-center text-sm leading-none"
      >
        {emoji}
      </span>
    ),
    Monogram: ({ text, color }) => <Monogram text={text} color={color} />,
    Image: ({ id }) => (
      <img
        alt=""
        src={`/project-icons/${id}`}
        width={16}
        height={16}
        className="size-4 shrink-0 object-contain"
      />
    ),
  });
}
