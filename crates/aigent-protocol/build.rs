use std::env;
use std::path::PathBuf;

fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let proto = manifest_dir.join("../../protocol/v1/aigent.proto");
    let include = manifest_dir.join("../../protocol/v1");

    assert!(
        proto.is_file(),
        "missing protocol schema at {}",
        proto.display()
    );

    let protoc = protoc_bin_vendored::protoc_bin_path().expect("vendored protoc");

    println!("cargo:rerun-if-changed={}", proto.display());
    prost_build::Config::new()
        .protoc_executable(protoc)
        .compile_protos(&[proto], &[include])
        .expect("protobuf compilation failed");
}
