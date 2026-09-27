//! The agent reports the version in its `package.json`, which changesets bump with the rest of the
//! workspace, so both agents built from one commit report the same version.

fn main() {
    println!("cargo::rerun-if-changed=package.json");

    let manifest = std::fs::read_to_string("package.json").expect("package.json is readable");
    let after_key = &manifest[manifest
        .find("\"version\"")
        .expect("package.json has a version")
        + "\"version\"".len()..];
    let start = after_key.find('"').expect("the version is a string") + 1;
    let length = after_key[start..]
        .find('"')
        .expect("the version string ends");

    println!(
        "cargo::rustc-env=FLEETFROG_AGENT_VERSION={}",
        &after_key[start..start + length]
    );
}
