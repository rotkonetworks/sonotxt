// TEE attestation module
// generates attestation quotes and binds them to Noise static keys

use kokoro_common::{AttestationBundle, TeeType};
use sha2::{Sha256, Digest};

/// generate attestation for this TEE instance
/// binds the Noise static public key to the attestation quote
pub fn generate_attestation(static_key: &[u8]) -> Result<AttestationBundle, &'static str> {
    #[cfg(feature = "sev-snp")]
    {
        return generate_sev_snp_attestation(static_key);
    }

    #[cfg(feature = "tdx")]
    {
        return generate_tdx_attestation(static_key);
    }

    #[cfg(feature = "insecure")]
    {
        return generate_insecure_attestation(static_key);
    }

    #[allow(unreachable_code)]
    Err("no attestation feature enabled")
}

/// development mode - no real attestation
/// WARNING: provides no security guarantees
#[cfg(feature = "insecure")]
fn generate_insecure_attestation(static_key: &[u8]) -> Result<AttestationBundle, &'static str> {
    use rand::{thread_rng, RngCore};

    // fake quote - just random bytes
    let mut quote = vec![0u8; 64];
    thread_rng().fill_bytes(&mut quote);

    // binding signature: H(quote || static_key)
    let mut hasher = Sha256::new();
    hasher.update(&quote);
    hasher.update(static_key);
    let binding_sig = hasher.finalize().to_vec();

    Ok(AttestationBundle {
        quote,
        static_key: static_key.to_vec(),
        binding_sig,
        tee_type: TeeType::Insecure,
    })
}

/// AMD SEV-SNP attestation
/// generates real attestation report from /dev/sev-guest
#[cfg(feature = "sev-snp")]
fn generate_sev_snp_attestation(static_key: &[u8]) -> Result<AttestationBundle, &'static str> {
    use sev::firmware::guest::Firmware;

    // create report data by hashing the static key (64 bytes)
    let mut report_data = [0u8; 64];
    let mut hasher = Sha256::new();
    hasher.update(static_key);
    let hash = hasher.finalize();
    report_data[..32].copy_from_slice(&hash);

    // open /dev/sev-guest
    let mut fw = Firmware::open()
        .map_err(|_| "failed to open /dev/sev-guest")?;

    // request attestation report with our report_data
    // get_report returns Vec<u8> containing the raw report bytes
    let quote = fw.get_report(None, Some(report_data), None)
        .map_err(|_| "failed to get SEV-SNP attestation report")?;

    // binding signature: H(quote || static_key)
    let mut hasher = Sha256::new();
    hasher.update(&quote);
    hasher.update(static_key);
    let binding_sig = hasher.finalize().to_vec();

    tracing::info!("generated SEV-SNP attestation report ({} bytes)", quote.len());

    Ok(AttestationBundle {
        quote,
        static_key: static_key.to_vec(),
        binding_sig,
        tee_type: TeeType::SevSnp,
    })
}

/// Intel TDX attestation
/// generates real attestation quote from /dev/tdx_guest
#[cfg(feature = "tdx")]
fn generate_tdx_attestation(static_key: &[u8]) -> Result<AttestationBundle, &'static str> {
    // create report data by hashing the static key (64 bytes)
    let mut report_data = [0u8; 64];
    let mut hasher = Sha256::new();
    hasher.update(static_key);
    let hash = hasher.finalize();
    report_data[..32].copy_from_slice(&hash);

    // get TDX quote using tdx_attest crate
    let quote = tdx_get_quote_impl(&report_data)?;

    // binding signature: H(quote || static_key)
    let mut hasher = Sha256::new();
    hasher.update(&quote);
    hasher.update(static_key);
    let binding_sig = hasher.finalize().to_vec();

    tracing::info!("generated TDX attestation quote ({} bytes)", quote.len());

    Ok(AttestationBundle {
        quote,
        static_key: static_key.to_vec(),
        binding_sig,
        tee_type: TeeType::Tdx,
    })
}

/// internal TDX quote generation using tdx_attest
#[cfg(feature = "tdx")]
fn tdx_get_quote_impl(_report_data: &[u8; 64]) -> Result<Vec<u8>, &'static str> {
    // tdx_attest crate provides low-level access to TDX guest device
    // the API varies by version, so we do manual device access
    use std::fs::File;

    // check if TDX device exists
    let _device = File::open("/dev/tdx_guest")
        .or_else(|_| File::open("/dev/tdx-guest"))
        .map_err(|_| "TDX device not found - not running in TDX VM")?;

    // in a real TDX VM, we would:
    // 1. create TDX report with report_data using configfs-tsm or ioctl
    // 2. send report to QGS (Quote Generation Service)
    // 3. receive signed quote back
    //
    // for now, return error indicating TDX is detected but full implementation
    // requires additional infrastructure (QGS daemon, etc.)
    Err("TDX detected but quote generation requires QGS infrastructure")
}

/// verify attestation quote (client-side)
#[allow(dead_code)]
pub fn verify_attestation(bundle: &AttestationBundle) -> Result<(), &'static str> {
    // first verify binding signature
    let mut hasher = Sha256::new();
    hasher.update(&bundle.quote);
    hasher.update(&bundle.static_key);
    let expected = hasher.finalize();

    if bundle.binding_sig != expected.as_slice() {
        return Err("binding signature mismatch");
    }

    match bundle.tee_type {
        TeeType::Insecure => {
            // just binding signature, no quote verification
            Ok(())
        }
        TeeType::SevSnp => {
            #[cfg(feature = "sev-snp")]
            {
                verify_sev_snp_quote(&bundle.quote, &bundle.static_key)
            }
            #[cfg(not(feature = "sev-snp"))]
            {
                Err("SEV-SNP verification not available (feature disabled)")
            }
        }
        TeeType::Tdx => {
            #[cfg(feature = "tdx")]
            {
                verify_tdx_quote(&bundle.quote, &bundle.static_key)
            }
            #[cfg(not(feature = "tdx"))]
            {
                Err("TDX verification not available (feature disabled)")
            }
        }
    }
}

/// verify SEV-SNP attestation report
#[cfg(feature = "sev-snp")]
fn verify_sev_snp_quote(quote: &[u8], static_key: &[u8]) -> Result<(), &'static str> {
    // SEV-SNP attestation report is 1184 bytes (per AMD spec)
    // the report_data field is at offset 80, 64 bytes
    const REPORT_DATA_OFFSET: usize = 80;

    if quote.len() < REPORT_DATA_OFFSET + 64 {
        return Err("invalid SEV-SNP report size");
    }

    // verify report_data contains H(static_key) in first 32 bytes
    let mut hasher = Sha256::new();
    hasher.update(static_key);
    let expected_hash = hasher.finalize();

    let report_data = &quote[REPORT_DATA_OFFSET..REPORT_DATA_OFFSET + 32];
    if report_data != expected_hash.as_slice() {
        return Err("static key not bound to SEV-SNP report");
    }

    // in production: verify signature using AMD certificate chain from KDS
    // requires fetching VCEK from AMD KDS based on chip_id and tcb_version
    tracing::info!("SEV-SNP report structure verified (full signature verification requires AMD KDS)");

    Ok(())
}

/// verify TDX attestation quote
#[cfg(feature = "tdx")]
fn verify_tdx_quote(quote: &[u8], static_key: &[u8]) -> Result<(), &'static str> {
    // TDX quote format (v4/v5):
    // - header (48 bytes)
    // - body (584 bytes for v4) containing report_data at offset 368 from start
    const REPORT_DATA_OFFSET: usize = 368;

    if quote.len() < REPORT_DATA_OFFSET + 64 {
        return Err("invalid TDX quote size");
    }

    // verify report_data contains H(static_key) in first 32 bytes
    let mut hasher = Sha256::new();
    hasher.update(static_key);
    let expected_hash = hasher.finalize();

    let report_data = &quote[REPORT_DATA_OFFSET..REPORT_DATA_OFFSET + 32];
    if report_data != expected_hash.as_slice() {
        return Err("static key not bound to TDX quote");
    }

    // in production: verify quote signature using Intel QVL/DCAP
    tracing::info!("TDX quote structure verified (full signature verification requires Intel QVL)");

    Ok(())
}
