// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ConsciousnessMirrorNFT
 * @notice ERC-721 collection of 20 Consciousness Mirror NFTs for VinelandEternal.
 *
 * Collection layout (tokenId → category):
 *   1–12   Journey NFTs  — 12 consciousness waypoints along the ScrollVerse path.
 *  13–19   Pillar NFTs   — 7 foundational pillars of ScrollSoul alignment.
 *    20    Master NFT    — The singular Omni-Mirror of total consciousness.
 *
 * Each token's metadata URI points to a JSON-LD document that encodes:
 *   • Solfeggio frequency (Hz)
 *   • Consciousness waypoint / pillar name
 *   • Category (Journey | Pillar | Master)
 *   • ScrollVerse on-chain traits
 *
 * The token URIs are set at deployment and can only be updated by the owner.
 * Base URI defaults to the repository path; override via setBaseURI().
 *
 * Public minting: tokens are sold sequentially starting from id 1.
 * The owner sets mintPrice and can pause/resume minting.
 * Proceeds are withdrawable by the owner via withdraw().
 */
contract ConsciousnessMirrorNFT {

    // -----------------------------------------------------------------------
    // Collection constants
    // -----------------------------------------------------------------------

    uint256 public constant TOTAL_SUPPLY       = 20;
    uint256 public constant JOURNEY_START      = 1;
    uint256 public constant JOURNEY_END        = 12;
    uint256 public constant PILLAR_START       = 13;
    uint256 public constant PILLAR_END         = 19;
    uint256 public constant MASTER_TOKEN_ID    = 20;

    // -----------------------------------------------------------------------
    // ERC-721 state
    // -----------------------------------------------------------------------

    string public constant name   = "Consciousness Mirror";
    string public constant symbol = "CMIRROR";

    mapping(uint256 => address) private _owners;
    mapping(address => uint256) private _balances;
    mapping(uint256 => address) private _tokenApprovals;
    mapping(address => mapping(address => bool)) private _operatorApprovals;

    // -----------------------------------------------------------------------
    // Metadata
    // -----------------------------------------------------------------------

    string private _baseURI;

    // -----------------------------------------------------------------------
    // Public mint state
    // -----------------------------------------------------------------------

    /// @notice Price in wei for one token during public mint.
    uint256 public mintPrice;

    /// @notice Next token ID to be sold in the public mint queue (1-based).
    uint256 public nextMintId;

    /// @notice When true the public mint function is open; owner can flip this.
    bool public mintActive;

    // -----------------------------------------------------------------------
    // Ownership
    // -----------------------------------------------------------------------

    address public owner;

    // -----------------------------------------------------------------------
    // Events (ERC-721)
    // -----------------------------------------------------------------------

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner_, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner_, address indexed operator, bool approved);
    event BaseURIUpdated(string previousURI, string newURI);
    event MintPriceUpdated(uint256 previousPrice, uint256 newPrice);
    event MintActiveUpdated(bool active);
    event Withdrawn(address indexed to, uint256 amount);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // -----------------------------------------------------------------------
    // Constructor
    // -----------------------------------------------------------------------

    /**
     * @param baseURI_   Base URI for token metadata, e.g.
     *                   "ipfs://QmXXX/" or "ar://TXID/" for Arweave.
     *                   Token URI = baseURI_ + tokenId + ".json"
     * @param mintPrice_ Initial public mint price in wei (e.g. 0.05 ether).
     *                   Set to 0 to make minting free.
     *
     * No tokens are pre-minted at deploy — they are minted on demand via
     * publicMint() or reserved via ownerMint() by the owner.
     */
    constructor(string memory baseURI_, uint256 mintPrice_) {
        owner      = msg.sender;
        _baseURI   = baseURI_;
        mintPrice  = mintPrice_;
        nextMintId = 1;
        mintActive = false; // owner enables when ready
    }

    // -----------------------------------------------------------------------
    // Modifiers
    // -----------------------------------------------------------------------

    modifier onlyOwner() {
        require(msg.sender == owner, "ConsciousnessMirrorNFT: caller is not owner");
        _;
    }

    // -----------------------------------------------------------------------
    // ERC-721 view functions
    // -----------------------------------------------------------------------

    function balanceOf(address account) external view returns (uint256) {
        require(account != address(0), "ConsciousnessMirrorNFT: zero address");
        return _balances[account];
    }

    function ownerOf(uint256 tokenId) public view returns (address) {
        address tokenOwner = _owners[tokenId];
        require(tokenOwner != address(0), "ConsciousnessMirrorNFT: nonexistent token");
        return tokenOwner;
    }

    function getApproved(uint256 tokenId) public view returns (address) {
        require(_owners[tokenId] != address(0), "ConsciousnessMirrorNFT: nonexistent token");
        return _tokenApprovals[tokenId];
    }

    function isApprovedForAll(address owner_, address operator) public view returns (bool) {
        return _operatorApprovals[owner_][operator];
    }

    // ERC-165
    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x80ac58cd   // ERC-721
            || interfaceId == 0x5b5e139f  // ERC-721Metadata
            || interfaceId == 0x01ffc9a7; // ERC-165
    }

    // -----------------------------------------------------------------------
    // Metadata
    // -----------------------------------------------------------------------

    /**
     * @notice Returns the full metadata URI for `tokenId`.
     *         Format: <baseURI><tokenId>.json
     */
    function tokenURI(uint256 tokenId) external view returns (string memory) {
        require(_owners[tokenId] != address(0), "ConsciousnessMirrorNFT: nonexistent token");
        return string(abi.encodePacked(_baseURI, _toString(tokenId), ".json"));
    }

    /**
     * @notice Returns the category label for a given token ID.
     */
    function categoryOf(uint256 tokenId) external pure returns (string memory) {
        require(tokenId >= 1 && tokenId <= TOTAL_SUPPLY, "ConsciousnessMirrorNFT: out of range");
        if (tokenId <= JOURNEY_END)      return "Journey";
        if (tokenId <= PILLAR_END)       return "Pillar";
        return "Master";
    }

    // -----------------------------------------------------------------------
    // ERC-721 mutating functions
    // -----------------------------------------------------------------------

    function approve(address to, uint256 tokenId) external {
        address tokenOwner = ownerOf(tokenId);
        require(
            msg.sender == tokenOwner || isApprovedForAll(tokenOwner, msg.sender),
            "ConsciousnessMirrorNFT: not owner nor approved for all"
        );
        _tokenApprovals[tokenId] = to;
        emit Approval(tokenOwner, to, tokenId);
    }

    function setApprovalForAll(address operator, bool approved) external {
        require(operator != msg.sender, "ConsciousnessMirrorNFT: approve to caller");
        _operatorApprovals[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        require(_isApprovedOrOwner(msg.sender, tokenId), "ConsciousnessMirrorNFT: not approved");
        _transfer(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        safeTransferFrom(from, to, tokenId, "");
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, bytes memory data) public {
        transferFrom(from, to, tokenId);
        require(
            _checkOnERC721Received(from, to, tokenId, data),
            "ConsciousnessMirrorNFT: non ERC721Receiver"
        );
    }

    // -----------------------------------------------------------------------
    // Public mint
    // -----------------------------------------------------------------------

    /**
     * @notice Mint the next available token.
     *         Caller must send at least `mintPrice` wei.
     *         Any excess payment is automatically refunded.
     *         Reverts when collection is sold out or mint is paused.
     */
    function publicMint() external payable {
        require(mintActive,               "ConsciousnessMirrorNFT: mint not active");
        require(nextMintId <= TOTAL_SUPPLY, "ConsciousnessMirrorNFT: sold out");
        require(msg.value >= mintPrice,   "ConsciousnessMirrorNFT: insufficient payment");

        uint256 tokenId = nextMintId;
        unchecked { nextMintId++; }
        _mint(msg.sender, tokenId);

        // Refund any overpayment
        uint256 excess = msg.value - mintPrice;
        if (excess > 0) {
            (bool ok, ) = msg.sender.call{value: excess}("");
            require(ok, "ConsciousnessMirrorNFT: refund failed");
        }
    }

    /**
     * @notice Mint `quantity` tokens directly to `to` without payment.
     *         Only the owner can call this — used for giveaways / reserves.
     */
    function ownerMint(address to, uint256 quantity) external onlyOwner {
        require(to != address(0), "ConsciousnessMirrorNFT: zero address");
        uint256 start = nextMintId;
        require(start + quantity - 1 <= TOTAL_SUPPLY, "ConsciousnessMirrorNFT: exceeds supply");
        for (uint256 i = 0; i < quantity; i++) {
            _mint(to, start + i);
        }
        unchecked { nextMintId = start + quantity; }
    }

    // -----------------------------------------------------------------------
    // Admin
    // -----------------------------------------------------------------------

    /**
     * @notice Enable or disable public minting.
     */
    function setMintActive(bool active) external onlyOwner {
        mintActive = active;
        emit MintActiveUpdated(active);
    }

    /**
     * @notice Update the public mint price (in wei).
     */
    function setMintPrice(uint256 newPrice) external onlyOwner {
        emit MintPriceUpdated(mintPrice, newPrice);
        mintPrice = newPrice;
    }

    /**
     * @notice Withdraw all ETH collected from minting to the owner.
     */
    function withdraw() external onlyOwner {
        uint256 amount = address(this).balance;
        require(amount > 0, "ConsciousnessMirrorNFT: nothing to withdraw");
        emit Withdrawn(owner, amount);
        (bool ok, ) = owner.call{value: amount}("");
        require(ok, "ConsciousnessMirrorNFT: withdraw failed");
    }

    /**
     * @notice Update the base URI for all token metadata.
     */
    function setBaseURI(string calldata newURI) external onlyOwner {
        emit BaseURIUpdated(_baseURI, newURI);
        _baseURI = newURI;
    }

    /**
     * @notice Transfer contract ownership.
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "ConsciousnessMirrorNFT: zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    function _mint(address to, uint256 tokenId) internal {
        require(to != address(0), "ConsciousnessMirrorNFT: mint to zero address");
        require(_owners[tokenId] == address(0), "ConsciousnessMirrorNFT: already minted");
        _balances[to]   += 1;
        _owners[tokenId] = to;
        emit Transfer(address(0), to, tokenId);
    }

    function _transfer(address from, address to, uint256 tokenId) internal {
        require(ownerOf(tokenId) == from, "ConsciousnessMirrorNFT: transfer of wrong owner");
        require(to != address(0),         "ConsciousnessMirrorNFT: transfer to zero address");
        delete _tokenApprovals[tokenId];
        _balances[from] -= 1;
        _balances[to]   += 1;
        _owners[tokenId] = to;
        emit Transfer(from, to, tokenId);
    }

    function _isApprovedOrOwner(address spender, uint256 tokenId) internal view returns (bool) {
        address tokenOwner = ownerOf(tokenId);
        return spender == tokenOwner
            || getApproved(tokenId) == spender
            || isApprovedForAll(tokenOwner, spender);
    }

    function _checkOnERC721Received(
        address from, address to, uint256 tokenId, bytes memory data
    ) private returns (bool) {
        if (to.code.length == 0) return true;
        (bool success, bytes memory retval) = to.call(
            abi.encodeWithSignature(
                "onERC721Received(address,address,uint256,bytes)",
                msg.sender, from, tokenId, data
            )
        );
        return success && bytes4(retval) == bytes4(keccak256("onERC721Received(address,address,uint256,bytes)"));
    }

    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) { digits++; temp /= 10; }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits--;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }
}
