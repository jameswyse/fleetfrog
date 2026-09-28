import { maskPersonal, personalParts } from "./personalText.ts";
import { usePreferences } from "./preferences.ts";

/** Text such as a path or a run's output, with any account names in it marked personal. */
export function PersonalText({ children }: { readonly children: string }) {
  let offset = 0;

  return personalParts(children).map(({ text, personal }) => {
    // Where the part starts, which is unique within the text.
    const key = offset;

    offset += text.length;

    return personal ? (
      <span key={key} data-personal>
        {text}
      </span>
    ) : (
      text
    );
  });
}

/** Hides account names while blurring is on, for text that CSS can't blur, such as a tooltip. */
export function useMaskPersonal(): (text: string) => string {
  return usePreferences().blurPersonal ? maskPersonal : (text) => text;
}
