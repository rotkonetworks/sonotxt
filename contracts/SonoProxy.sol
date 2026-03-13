// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title sonotxt ERC1967 upgrade proxy
/// @notice Minimal delegatecall proxy. No dependencies.
///   Storage lives in the proxy, implementation is swappable.
///   Uses EIP-1967 storage slots to avoid collisions.
contract SonoProxy {
    /// @dev keccak256("eip1967.proxy.implementation") - 1
    bytes32 private constant IMPL_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
    /// @dev keccak256("eip1967.proxy.admin") - 1
    bytes32 private constant ADMIN_SLOT = 0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103;

    event Upgraded(address indexed implementation);
    event AdminChanged(address indexed previousAdmin, address indexed newAdmin);

    constructor(address implementation, bytes memory initData) {
        _setAdmin(msg.sender);
        _setImpl(implementation);
        if (initData.length > 0) {
            (bool ok,) = implementation.delegatecall(initData);
            require(ok, "init failed");
        }
        emit Upgraded(implementation);
    }

    /// @notice Upgrade implementation. Only admin.
    function upgradeToAndCall(address newImpl, bytes calldata data) external {
        require(msg.sender == _admin(), "not admin");
        require(newImpl != address(0), "zero address");
        _setImpl(newImpl);
        if (data.length > 0) {
            (bool ok,) = newImpl.delegatecall(data);
            require(ok, "upgrade call failed");
        }
        emit Upgraded(newImpl);
    }

    function changeAdmin(address newAdmin) external {
        address prev = _admin();
        require(msg.sender == prev, "not admin");
        require(newAdmin != address(0), "zero address");
        _setAdmin(newAdmin);
        emit AdminChanged(prev, newAdmin);
    }

    function admin() external view returns (address) { return _admin(); }
    function implementation() external view returns (address) { return _impl(); }

    fallback() external payable {
        address impl = _impl();
        assembly {
            calldatacopy(0, 0, calldatasize())
            let ok := delegatecall(gas(), impl, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch ok
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }

    receive() external payable {
        address impl = _impl();
        assembly {
            let ok := delegatecall(gas(), impl, 0, 0, 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch ok
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }

    function _impl() private view returns (address a) { assembly { a := sload(IMPL_SLOT) } }
    function _admin() private view returns (address a) { assembly { a := sload(ADMIN_SLOT) } }
    function _setImpl(address a) private { assembly { sstore(IMPL_SLOT, a) } }
    function _setAdmin(address a) private { assembly { sstore(ADMIN_SLOT, a) } }
}
