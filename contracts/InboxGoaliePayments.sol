// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 value) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract InboxGoaliePayments {
    IERC20 public immutable usdc;
    address public owner;
    address public operator;
    address public treasury;
    mapping(bytes32 => bool) public settled;

    event PaymentSettled(bytes32 indexed paymentId, address indexed receiver, uint256 grossAmount, uint256 receiverAmount, uint256 platformFee, uint16 feeBps);
    event TreasuryUpdated(address indexed treasury);
    event OperatorUpdated(address indexed operator);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);

    error Unauthorized();
    error InvalidAddress();
    error AlreadySettled();
    error InvalidFee();
    error InsufficientUSDC();
    error TransferFailed();

    modifier onlyOwner() { if (msg.sender != owner) revert Unauthorized(); _; }
    modifier onlyOperator() { if (msg.sender != operator) revert Unauthorized(); _; }

    constructor(address usdcAddress, address treasuryAddress, address operatorAddress) {
        if (usdcAddress == address(0) || treasuryAddress == address(0) || operatorAddress == address(0)) revert InvalidAddress();
        usdc = IERC20(usdcAddress);
        treasury = treasuryAddress;
        operator = operatorAddress;
        owner = msg.sender;
    }

    function settlePayment(bytes32 paymentId, address receiver, uint256 amount, uint16 feeBps) external onlyOperator {
        if (settled[paymentId]) revert AlreadySettled();
        if (receiver == address(0)) revert InvalidAddress();
        if (feeBps > 10_000) revert InvalidFee();
        if (usdc.balanceOf(address(this)) < amount) revert InsufficientUSDC();

        settled[paymentId] = true;
        uint256 fee = (amount * feeBps) / 10_000;
        uint256 receiverAmount = amount - fee;
        if (!usdc.transfer(receiver, receiverAmount)) revert TransferFailed();
        if (fee > 0 && !usdc.transfer(treasury, fee)) revert TransferFailed();
        emit PaymentSettled(paymentId, receiver, amount, receiverAmount, fee, feeBps);
    }

    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert InvalidAddress();
        treasury = newTreasury;
        emit TreasuryUpdated(newTreasury);
    }

    function setOperator(address newOperator) external onlyOwner {
        if (newOperator == address(0)) revert InvalidAddress();
        operator = newOperator;
        emit OperatorUpdated(newOperator);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
