import { Option, Schema } from "effect";

const decodeText = Schema.decodeUnknownOption(Schema.String);

/** A text field's value from submitted form data, or empty when the form has no such field. */
export function formText(form: FormData, name: string): string {
  return decodeText(form.get(name)).pipe(Option.getOrElse(() => ""));
}
