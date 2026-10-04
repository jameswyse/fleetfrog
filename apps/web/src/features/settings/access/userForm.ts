import { Option, Schema } from "effect";

import { formText } from "@/ui/formText.ts";
import { Email, minimumPasswordLength } from "@fleetfrog/protocol/domain/user";

export const decodeEmail = Schema.decodeUnknownOption(Email);

export type Field = "displayName" | "email" | "password" | "confirm";

export interface FieldError {
  readonly field: Field;
  readonly message: string;
}

/** What's wrong with each field, or null when it's fine. */
const problems = {
  displayName: (values: FormData) =>
    formText(values, "displayName").trim() === "" ? "Enter a name." : null,
  email: (values: FormData) =>
    Option.isNone(decodeEmail(formText(values, "email")))
      ? "Enter an email address, such as ada@example.com."
      : null,
  password: (values: FormData, passwordOptional: boolean) => {
    const password = formText(values, "password");

    return (passwordOptional && password === "") || password.length >= minimumPasswordLength
      ? null
      : `Use at least ${minimumPasswordLength} characters.`;
  },
  confirm: (values: FormData) =>
    formText(values, "password") === formText(values, "confirm")
      ? null
      : "The passwords don't match.",
} satisfies Record<Field, (values: FormData, passwordOptional: boolean) => string | null>;

/** Checks the form's fields in order, focusing the first invalid one. */
export function checkFields(
  form: HTMLFormElement,
  fields: ReadonlyArray<Field>,
  options: { readonly passwordOptional: boolean } = { passwordOptional: false },
): ReadonlyArray<FieldError> {
  const values = new FormData(form);

  const errors = fields.flatMap((field) => {
    const message = problems[field](values, options.passwordOptional);

    return message === null ? [] : [{ field, message }];
  });

  const input = errors[0] === undefined ? null : form.elements.namedItem(errors[0].field);

  if (input instanceof HTMLInputElement) {
    input.focus();
  }

  return errors;
}

export function messageFor(errors: ReadonlyArray<FieldError>, field: Field): string | undefined {
  return errors.find((error) => error.field === field)?.message;
}
