//! Converts one storey of an IFC file to a plan, for development:
//!   cargo run -p domotwin-ifc --example ifc2plan -- <file.ifc> [storey index] > out.domotwin.json
#![allow(clippy::print_stdout, clippy::print_stderr)]

use domotwin_ifc::IfcFile;

fn main() {
    let mut args = std::env::args().skip(1);
    let Some(path) = args.next() else {
        eprintln!("usage: ifc2plan <file.ifc> [storey index]");
        std::process::exit(2);
    };
    let index: usize = args.next().and_then(|s| s.parse().ok()).unwrap_or(0);
    let bytes = match std::fs::read(&path) {
        Ok(bytes) => bytes,
        Err(err) => {
            eprintln!("{path}: {err}");
            std::process::exit(1);
        }
    };
    let file = match IfcFile::read(bytes) {
        Ok(file) => file,
        Err(code) => {
            eprintln!("{path}: {code}");
            std::process::exit(1);
        }
    };
    let storeys = file.storeys();
    for (i, s) in storeys.iter().enumerate() {
        eprintln!(
            "{i}: {} ({} cm): {} spaces, {} doors, {} windows, {} pieces",
            s.name, s.elevation, s.spaces, s.doors, s.windows, s.furniture
        );
    }
    let Some(storey) = storeys.get(index) else {
        eprintln!("no storey {index}");
        std::process::exit(1);
    };
    match file.convert(storey.id) {
        Ok((plan, report, upkeep)) => {
            eprintln!("{report:?}");
            eprintln!("{} upkeep cards", upkeep.len());
            println!("{plan:#}");
        }
        Err(code) => {
            eprintln!("{code}");
            std::process::exit(1);
        }
    }
}
