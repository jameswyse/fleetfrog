interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

// oxlint-disable-next-line import/no-default-export -- Workers loads the default export as the Worker's handlers.
export default {
  fetch(request: Request, env: Env): Response | Promise<Response> {
    const url = new URL(request.url);

    if (url.hostname === "www.fleetfrog.dev") {
      url.protocol = "https:";
      url.hostname = "fleetfrog.dev";

      return Response.redirect(url, 301);
    }

    return env.ASSETS.fetch(request);
  },
};
