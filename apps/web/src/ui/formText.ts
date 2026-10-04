import { Option, Schema } from "effect";

const decodeText = Schema.decodeUnknownOption(Schema.String);

export function formText(form: FormData, name: string): string {
  return decodeText(form.get(name)).pipe(Option.getOrElse(() => ""));
}
