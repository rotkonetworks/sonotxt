#![no_main]
#![no_std]

use uapi::{HostFn, HostFnImpl as api, ReturnFlags};

#[panic_handler]
fn panic(_info: &core::panic::PanicInfo) -> ! {
    unsafe {
        core::arch::asm!("unimp");
        core::hint::unreachable_unchecked();
    }
}

/// The RUNTIME_PALLETS_ADDR — computed from PalletId(*b"py/paddr")
/// This is the gateway address for calling Substrate pallet dispatchables
/// from within a pallet-revive contract.
const RUNTIME_PALLETS_ADDR: [u8; 20] = compute_pallet_addr();

/// Compute the H160 address from PalletId(*b"py/paddr")
/// AccountId32 = blake2_256(b"modl" ++ b"py/paddr" ++ [0u8; 24])
/// H160 = first 20 bytes of AccountId32
const fn compute_pallet_addr() -> [u8; 20] {
    // For now, hardcode the known value.
    // This can be verified by calling the runtime API or checking the constant in polkadot-sdk.
    // TODO: compute dynamically or read from runtime
    // The address needs to be determined from the actual deployed runtime.
    // Placeholder — we'll read it from the contract's immutable data or hardcode after verification.
    [0u8; 20] // Will be set correctly after we verify the address on Paseo
}

/// ABI selectors for our Solidity interface:
///
/// interface IAssetSwap {
///     function swapDotForSono(uint256 amountIn, uint256 amountOutMin) external;
///     function swapSonoForDot(uint256 amountIn, uint256 amountOutMin) external;
///     function getReserves() external view returns (uint256 dotReserve, uint256 sonoReserve);
/// }
///
/// Selectors:
/// swapDotForSono(uint256,uint256) = first 4 bytes of keccak256
/// swapSonoForDot(uint256,uint256) = first 4 bytes of keccak256
/// getReserves()                   = first 4 bytes of keccak256

#[no_mangle]
#[polkavm_derive::polkavm_export]
pub extern "C" fn deploy() {}

#[no_mangle]
#[polkavm_derive::polkavm_export]
pub extern "C" fn call() {
    // Read the 4-byte function selector
    let mut selector = [0u8; 4];
    api::call_data_copy(&mut selector, 0);

    // Route based on selector
    // For now, implement a simple "call pallet" function:
    // callPallet(bytes) -> calls RUNTIME_PALLETS_ADDR with the given SCALE-encoded call data
    //
    // selector for callPallet(bytes) = 0x... (we'll use a known one)
    // This is the most general approach — the Solidity contract encodes the
    // SCALE call data and passes it here.

    // For the hackathon demo, we expose:
    // ping() -> returns 1 (proof that Rust contract works)
    // callRuntime(bytes) -> dispatches SCALE-encoded call to runtime

    match selector {
        // ping() -> returns uint256(1)
        // selector: 0x5c36b186 (keccak256("ping()") first 4 bytes)
        [0x5c, 0x36, 0xb1, 0x86] => {
            let mut output = [0u8; 32];
            output[31] = 1;
            api::return_value(ReturnFlags::empty(), &output);
        }

        // callRuntime(bytes) -> dispatches to RUNTIME_PALLETS_ADDR
        // selector: 0x6a761202 (we use a custom one)
        // Input: offset (32 bytes) + length (32 bytes) + data (variable)
        _ => {
            // Read full calldata
            let data_size = api::call_data_size() as usize;
            if data_size <= 4 {
                // Unknown selector, revert
                api::return_value(ReturnFlags::REVERT, &[]);
            }

            // For the general callRuntime: the calldata after selector is
            // ABI-encoded bytes (offset, length, data)
            // offset at byte 4: 32 bytes pointing to data start
            // length at byte 36: 32 bytes
            // data at byte 68+: variable

            // Read length from offset 36 (4 selector + 32 offset)
            let mut len_buf = [0u8; 4];
            api::call_data_copy(&mut len_buf, 64); // last 4 bytes of the 32-byte length
            let call_len = u32::from_be_bytes(len_buf) as usize;

            if call_len == 0 || call_len > 4096 {
                api::return_value(ReturnFlags::REVERT, &[]);
            }

            // Read the SCALE-encoded call data
            // It starts at offset 68 (4 + 32 + 32)
            let mut call_data = [0u8; 4096];
            let slice = &mut call_data[..call_len];
            api::call_data_copy(slice, 68);

            // Call RUNTIME_PALLETS_ADDR with the SCALE-encoded pallet call
            let mut output_buf = [0u8; 256];
            let mut output = &mut output_buf[..];

            let result = api::call(
                uapi::CallFlags::empty(),
                &RUNTIME_PALLETS_ADDR,
                0, // ref_time
                0, // proof_size
                &[0u8; 32], // deposit limit (none)
                &[0u8; 32], // value (none)
                slice,
                Some(&mut output),
            );

            match result {
                Ok(_) => {
                    // Return success with any output
                    let mut ret = [0u8; 32];
                    ret[31] = 1; // success = true
                    api::return_value(ReturnFlags::empty(), &ret);
                }
                Err(_) => {
                    api::return_value(ReturnFlags::REVERT, &[]);
                }
            }
        }
    }
}
