import { Fragment } from "react";

export function PathText({ path }: { readonly path: string }) {
  const parts = path.split("/");

  return parts.map((part, index) => (
    <Fragment key={parts.slice(0, index + 1).join("/")}>
      {index > 0 && (
        <>
          /<wbr />
        </>
      )}
      {part}
    </Fragment>
  ));
}
