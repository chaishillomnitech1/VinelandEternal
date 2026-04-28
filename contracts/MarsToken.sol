// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title MarsToken ($MARS)
 * @notice Governance and utility token for the Mars DAO ecosystem.
 *
 * Economics
 * ─────────
 *   • Fixed supply minted to the deployer at construction.
 *   • 2.5 % Zakat deducted on every transfer and forwarded to the DAO's
 *     zakat treasury — funding community-benefit programs automatically.
 *   • 1 % Governance Reserve deducted and held in this contract for future
 *     quadratic-voting subsidies and DAO operations.
 *
 * Total transfer deduction: 3.5 % (350 basis points).
 *
 * The fee rates are immutable by design; only the zakatTreasury address
 * can be updated by the contract owner.
 */
contract MarsToken {

    // ── ERC-20 state ─────────────────────────────────────────────────────────

    string  public constant name     = "Mars Token";
    string  public constant symbol   = "MARS";
    uint8   public constant decimals = 18;

    uint256 public totalSupply;

    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;

    // ── Fee configuration (immutable) ─────────────────────────────────────────

    /// @notice Zakat rate: 2.5 % = 250 bps.
    uint256 public constant ZAKAT_BPS   = 250;

    /// @notice Governance reserve rate: 1 % = 100 bps.
    uint256 public constant RESERVE_BPS = 100;

    uint256 private constant BPS_BASE   = 10_000;

    // ── Governance reserve pool ───────────────────────────────────────────────

    /// @notice Accumulated $MARS available for governance subsidies.
    uint256 public governanceReserve;

    // ── Zakat treasury ────────────────────────────────────────────────────────

    /// @notice Address that receives the zakat portion of every transfer.
    address public zakatTreasury;

    // ── Ownership ────────────────────────────────────────────────────────────

    address public owner;

    // ── Events ───────────────────────────────────────────────────────────────

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner_, address indexed spender, uint256 value);
    event ZakatTransferred(address indexed to, uint256 amount);
    event ZakatTreasuryUpdated(address indexed prev, address indexed next);
    event OwnershipTransferred(address indexed prev, address indexed next);
    event GovernanceReserveWithdrawn(address indexed to, uint256 amount);

    // ── Constructor ──────────────────────────────────────────────────────────

    /**
     * @param initialSupply  Total tokens (without decimals — multiplied by 10^18).
     * @param zakatTreasury_ Recipient of the 2.5% zakat on every transfer.
     */
    constructor(uint256 initialSupply, address zakatTreasury_) {
        require(zakatTreasury_ != address(0), "MarsToken: zero zakat treasury");

        owner          = msg.sender;
        zakatTreasury  = zakatTreasury_;

        uint256 amount = initialSupply * (10 ** decimals);
        _balances[msg.sender] = amount;
        totalSupply           = amount;
        emit Transfer(address(0), msg.sender, amount);
    }

    // ── Modifier ─────────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "MarsToken: caller is not owner");
        _;
    }

    // ── ERC-20 view ───────────────────────────────────────────────────────────

    function balanceOf(address account) public view returns (uint256) {
        return _balances[account];
    }

    function allowance(address owner_, address spender) public view returns (uint256) {
        return _allowances[owner_][spender];
    }

    // ── ERC-20 mutating ───────────────────────────────────────────────────────

    function approve(address spender, uint256 amount) external returns (bool) {
        _approve(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transferWithFees(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 cur = _allowances[from][msg.sender];
        require(cur >= amount, "MarsToken: transfer amount exceeds allowance");
        unchecked { _allowances[from][msg.sender] = cur - amount; }
        _transferWithFees(from, to, amount);
        return true;
    }

    // ── Fee-bearing transfer ──────────────────────────────────────────────────

    function _transferWithFees(address from, address to, uint256 amount) internal {
        require(from != address(0), "MarsToken: transfer from zero address");
        require(to   != address(0), "MarsToken: transfer to zero address");
        require(_balances[from] >= amount, "MarsToken: transfer amount exceeds balance");

        uint256 zakatFee   = (amount * ZAKAT_BPS)   / BPS_BASE;
        uint256 reserveFee = (amount * RESERVE_BPS)  / BPS_BASE;
        uint256 net        = amount - zakatFee - reserveFee;

        _balances[from] -= amount;
        emit Transfer(from, address(0), zakatFee + reserveFee);

        _balances[to] += net;
        emit Transfer(from, to, net);

        // Zakat → treasury
        if (zakatFee > 0) {
            _balances[zakatTreasury] += zakatFee;
            emit Transfer(from, zakatTreasury, zakatFee);
            emit ZakatTransferred(zakatTreasury, zakatFee);
        }

        // Reserve → this contract
        if (reserveFee > 0) {
            governanceReserve      += reserveFee;
            _balances[address(this)] += reserveFee;
            emit Transfer(from, address(this), reserveFee);
        }
    }

    // ── Admin ────────────────────────────────────────────────────────────────

    /// @notice Update the zakat treasury address.
    function setZakatTreasury(address newTreasury) external onlyOwner {
        require(newTreasury != address(0), "MarsToken: zero address");
        emit ZakatTreasuryUpdated(zakatTreasury, newTreasury);
        zakatTreasury = newTreasury;
    }

    /// @notice Withdraw governance reserve tokens to a specified address.
    function withdrawGovernanceReserve(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "MarsToken: zero address");
        require(amount <= governanceReserve, "MarsToken: exceeds reserve");
        governanceReserve      -= amount;
        _balances[address(this)] -= amount;
        _balances[to]            += amount;
        emit Transfer(address(this), to, amount);
        emit GovernanceReserveWithdrawn(to, amount);
    }

    /// @notice Transfer contract ownership.
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "MarsToken: zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    // ── Internal ─────────────────────────────────────────────────────────────

    function _approve(address owner_, address spender, uint256 amount) internal {
        require(owner_  != address(0), "MarsToken: approve from zero address");
        require(spender != address(0), "MarsToken: approve to zero address");
        _allowances[owner_][spender] = amount;
        emit Approval(owner_, spender, amount);
    }
}
