// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title MirrorToken ($MIRROR)
 * @notice ERC-20 token for the VinelandEternal ScrollVerse ecosystem.
 *
 * On every token transfer two automatic deductions are applied before the net
 * amount reaches the recipient:
 *
 *   • 2 % Consciousness Dividend — accumulated in the dividendPool and
 *     claimable pro-rata by all holders via claimDividend().
 *
 *   • 2.5 % Zakat — forwarded directly to the zakatPool address, which
 *     governs charitable / community-support disbursements.
 *
 * Total deduction per transfer: 4.5 % (450 basis points).
 *
 * The contract owner can update the zakatPool address but cannot alter
 * the fee rates — they are immutable by design.
 */
contract MirrorToken {

    // -----------------------------------------------------------------------
    // ERC-20 state
    // -----------------------------------------------------------------------

    string  public constant name     = "Mirror Token";
    string  public constant symbol   = "MIRROR";
    uint8   public constant decimals = 18;

    uint256 public totalSupply;

    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;

    // -----------------------------------------------------------------------
    // Fee configuration (immutable)
    // -----------------------------------------------------------------------

    /// @notice Basis-point rate for the Consciousness Dividend (2 % = 200 bps).
    uint256 public constant DIVIDEND_BPS = 200;

    /// @notice Basis-point rate for Zakat (2.5 % = 250 bps).
    uint256 public constant ZAKAT_BPS    = 250;

    uint256 private constant BPS_BASE = 10_000;

    // -----------------------------------------------------------------------
    // Dividend accounting
    // -----------------------------------------------------------------------

    /// @notice Accumulated tokens awaiting pro-rata distribution to holders.
    uint256 public dividendPool;

    /// @dev Magnified dividend per share — uses a large multiplier to retain
    ///      precision when balances are small relative to the pool.
    uint256 private constant MAGNITUDE = 2 ** 128;

    uint256 private _magnifiedDividendPerShare;

    /// @dev Correction terms to handle balance changes mid-stream.
    mapping(address => int256) private _magnifiedDividendCorrections;

    /// @dev Already-withdrawn dividends per address (in magnified units).
    mapping(address => uint256) private _withdrawnDividends;

    // -----------------------------------------------------------------------
    // Zakat pool
    // -----------------------------------------------------------------------

    /// @notice Address that receives the zakat portion of every transfer.
    address public zakatPool;

    // -----------------------------------------------------------------------
    // Ownership
    // -----------------------------------------------------------------------

    address public owner;

    // -----------------------------------------------------------------------
    // Events
    // -----------------------------------------------------------------------

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner_, address indexed spender, uint256 value);
    event DividendDistributed(uint256 amount);
    event DividendWithdrawn(address indexed account, uint256 amount);
    event ZakatTransferred(address indexed to, uint256 amount);
    event ZakatPoolUpdated(address indexed previousPool, address indexed newPool);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // -----------------------------------------------------------------------
    // Constructor
    // -----------------------------------------------------------------------

    /**
     * @param initialSupply  Total tokens to mint (without decimals — the
     *                       contract multiplies by 10^18 internally).
     * @param zakatPool_     Initial address of the zakat community pool.
     */
    constructor(uint256 initialSupply, address zakatPool_) {
        require(zakatPool_ != address(0), "MirrorToken: zakat pool is zero address");

        owner     = msg.sender;
        zakatPool = zakatPool_;

        uint256 mintAmount = initialSupply * (10 ** decimals);
        _mint(msg.sender, mintAmount);
    }

    // -----------------------------------------------------------------------
    // Modifiers
    // -----------------------------------------------------------------------

    modifier onlyOwner() {
        require(msg.sender == owner, "MirrorToken: caller is not owner");
        _;
    }

    // -----------------------------------------------------------------------
    // ERC-20 view functions
    // -----------------------------------------------------------------------

    function balanceOf(address account) public view returns (uint256) {
        return _balances[account];
    }

    function allowance(address owner_, address spender) public view returns (uint256) {
        return _allowances[owner_][spender];
    }

    // -----------------------------------------------------------------------
    // ERC-20 mutating functions
    // -----------------------------------------------------------------------

    function approve(address spender, uint256 amount) external returns (bool) {
        _approve(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transferWithFees(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 currentAllowance = _allowances[from][msg.sender];
        require(currentAllowance >= amount, "MirrorToken: transfer amount exceeds allowance");
        unchecked { _allowances[from][msg.sender] = currentAllowance - amount; }
        _transferWithFees(from, to, amount);
        return true;
    }

    // -----------------------------------------------------------------------
    // Transfer with fee deduction
    // -----------------------------------------------------------------------

    /**
     * @dev Core transfer that deducts dividend + zakat fees.
     *      Sender pays the full `amount`; recipient receives the net.
     */
    function _transferWithFees(address from, address to, uint256 amount) internal {
        require(from != address(0), "MirrorToken: transfer from zero address");
        require(to   != address(0), "MirrorToken: transfer to zero address");
        require(_balances[from] >= amount, "MirrorToken: transfer amount exceeds balance");

        uint256 dividendFee = (amount * DIVIDEND_BPS) / BPS_BASE;
        uint256 zakatFee    = (amount * ZAKAT_BPS)    / BPS_BASE;
        uint256 netAmount   = amount - dividendFee - zakatFee;

        // Debit sender
        _updateBalance(from, _balances[from] - amount, false);
        emit Transfer(from, address(0), dividendFee + zakatFee);

        // Credit recipient (net)
        _updateBalance(to, _balances[to] + netAmount, true);
        emit Transfer(from, to, netAmount);

        // Accumulate dividend in the pool
        if (dividendFee > 0) {
            _distributeDividend(dividendFee);
        }

        // Forward zakat directly to the pool
        if (zakatFee > 0) {
            _updateBalance(zakatPool, _balances[zakatPool] + zakatFee, true);
            emit Transfer(from, zakatPool, zakatFee);
            emit ZakatTransferred(zakatPool, zakatFee);
        }
    }

    // -----------------------------------------------------------------------
    // Dividend distribution
    // -----------------------------------------------------------------------

    /**
     * @dev Spread `amount` tokens across all current holders by increasing
     *      the magnified-dividend-per-share accumulator.
     *      Tokens are held in this contract until claimed.
     */
    function _distributeDividend(uint256 amount) internal {
        if (totalSupply == 0) return;

        dividendPool += amount;
        _magnifiedDividendPerShare += (amount * MAGNITUDE) / totalSupply;
        emit DividendDistributed(amount);
    }

    /**
     * @notice Returns the dividend tokens currently available for `account`.
     */
    function dividendOf(address account) public view returns (uint256) {
        int256 magnified = int256(_magnifiedDividendPerShare * _balances[account]);
        int256 corrected = magnified + _magnifiedDividendCorrections[account];
        if (corrected <= 0) return 0;
        return (uint256(corrected) - _withdrawnDividends[account]) / MAGNITUDE;
    }

    /**
     * @notice Claim all accrued dividend tokens for the caller.
     */
    function claimDividend() external {
        uint256 claimable = dividendOf(msg.sender);
        require(claimable > 0, "MirrorToken: no dividend to claim");

        _withdrawnDividends[msg.sender] += claimable * MAGNITUDE;
        dividendPool -= claimable;

        _updateBalance(msg.sender, _balances[msg.sender] + claimable, true);
        emit Transfer(address(this), msg.sender, claimable);
        emit DividendWithdrawn(msg.sender, claimable);
    }

    // -----------------------------------------------------------------------
    // Balance helper (maintains dividend correction terms)
    // -----------------------------------------------------------------------

    function _updateBalance(address account, uint256 newBalance, bool increase) internal {
        uint256 oldBalance = _balances[account];
        _balances[account] = newBalance;

        int256 delta = int256(_magnifiedDividendPerShare) *
            (increase
                ? int256(newBalance - oldBalance)
                : -int256(oldBalance - newBalance));

        _magnifiedDividendCorrections[account] -= delta;
    }

    // -----------------------------------------------------------------------
    // Mint / Burn
    // -----------------------------------------------------------------------

    function _mint(address account, uint256 amount) internal {
        require(account != address(0), "MirrorToken: mint to zero address");
        totalSupply += amount;
        _magnifiedDividendCorrections[account] -=
            int256(_magnifiedDividendPerShare * amount);
        _balances[account] += amount;
        emit Transfer(address(0), account, amount);
    }

    // -----------------------------------------------------------------------
    // Admin
    // -----------------------------------------------------------------------

    /**
     * @notice Update the zakat pool address.
     * @param newPool The replacement pool — must be non-zero.
     */
    function setZakatPool(address newPool) external onlyOwner {
        require(newPool != address(0), "MirrorToken: new pool is zero address");
        emit ZakatPoolUpdated(zakatPool, newPool);
        zakatPool = newPool;
    }

    /**
     * @notice Transfer contract ownership to `newOwner`.
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "MirrorToken: new owner is zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    // -----------------------------------------------------------------------
    // Internal approve
    // -----------------------------------------------------------------------

    function _approve(address owner_, address spender, uint256 amount) internal {
        require(owner_  != address(0), "MirrorToken: approve from zero address");
        require(spender != address(0), "MirrorToken: approve to zero address");
        _allowances[owner_][spender] = amount;
        emit Approval(owner_, spender, amount);
    }
}
