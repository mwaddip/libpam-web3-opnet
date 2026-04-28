//! OPNet verification plugin for libpam-web3.
//!
//! Implements the plugin protocol: reads JSON from stdin, validates the
//! OTP and machine_id, and returns the wallet address from the auth-svc's
//! trusted assertion.
//!
//! # Protocol
//!
//! Discovery: install-time manifest at /usr/lib/libpam-web3/plugins/opnet.json,
//! written by postinst. PAM no longer queries the binary at startup.
//!
//! Verify:
//!   stdin:  {"sig": {chain, wallet_address, otp, machine_id}, "otp_message": "..."}
//!   stdout: wallet address (on success)
//!   exit:   0 = verified, 1 = denied
//!
//! # Trust Model
//!
//! The auth-svc has already verified the ML-DSA signature (~2KB, not included
//! in the .sig file). This plugin validates the OTP fields and returns the
//! wallet_address assertion. Defense-in-depth: the OTP and machine_id must
//! match the expected values.

use serde::Deserialize;
use std::io::Read;
use std::process;

#[derive(Deserialize)]
struct PluginInput {
    sig: OPNetSig,
    otp_message: String,
}

#[derive(Deserialize)]
struct OPNetSig {
    #[allow(dead_code)]
    chain: String,
    wallet_address: String,
    otp: String,
    machine_id: String,
}

fn main() {
    let mut input = String::new();
    if let Err(e) = std::io::stdin().read_to_string(&mut input) {
        eprintln!("failed to read stdin: {}", e);
        process::exit(1);
    }

    let parsed: PluginInput = match serde_json::from_str(&input) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("invalid input JSON: {}", e);
            process::exit(1);
        }
    };

    match verify(&parsed) {
        Ok(address) => {
            print!("{}", address);
            process::exit(0);
        }
        Err(e) => {
            eprintln!("{}", e);
            process::exit(1);
        }
    }
}

fn verify(input: &PluginInput) -> Result<String, String> {
    if input.sig.wallet_address.is_empty() {
        return Err("empty wallet_address".to_string());
    }

    // Verify OTP message matches expected format
    let expected_message = format!(
        "Authenticate to {} with code: {}",
        input.sig.machine_id, input.sig.otp
    );
    if input.otp_message != expected_message {
        return Err("otp_message mismatch".to_string());
    }

    Ok(input.sig.wallet_address.clone())
}
