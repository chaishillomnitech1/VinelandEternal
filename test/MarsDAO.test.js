/**
 * MarsDAO.test.js
 *
 * Comprehensive test suite for the MarsDAO governance contract.
 * Covers: deployment, voting power, proposal lifecycle (all 4 types),
 * council multisig, recall mechanism, guilds, health metrics, cross-DAO, admin.
 */

const { expect }  = require("chai");
const { ethers }  = require("hardhat");
const { time }    = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("MarsDAO", function () {
  let marsToken, mirrorToken, dao;
  let owner, zakatPool;
  let council;   // 5 council members
  let alice, bob, carol;

  const SUPPLY       = 1_000_000n;
  const VOTING_PERIOD = 7 * 24 * 3600;       // 7 days in seconds
  const TIMELOCK      = 7 * 24 * 3600;       // 7-day treasury timelock
  const EMERGENCY_WIN = 24 * 3600;           // 24 hours
  const TERM_DURATION = 180 * 24 * 3600;     // 180 days

  // Proposal types
  const TYPE_STANDARD       = 0;
  const TYPE_TREASURY       = 1;
  const TYPE_CONSTITUTIONAL = 2;
  const TYPE_EMERGENCY      = 3;

  // Proposal states
  const STATE_ACTIVE    = 0;
  const STATE_PASSED    = 1;
  const STATE_REJECTED  = 2;
  const STATE_EXECUTED  = 3;
  const STATE_TIMELOCK  = 5;

  // Guilds
  const GUILD_TECH   = 0;
  const GUILD_AGRI   = 1;
  const GUILD_HEALTH = 2;
  const GUILD_EDU    = 3;
  const GUILD_CIVICS = 4;

  async function deployContracts() {
    [owner, zakatPool, ...rest] = await ethers.getSigners();
    council = rest.slice(0, 5);
    [alice, bob, carol] = rest.slice(5, 8);

    // Deploy MarsToken
    const MarsToken = await ethers.getContractFactory("MarsToken");
    marsToken = await MarsToken.deploy(SUPPLY, zakatPool.address);
    await marsToken.waitForDeployment();

    // Deploy MirrorToken
    const MirrorToken = await ethers.getContractFactory("MirrorToken");
    mirrorToken = await MirrorToken.deploy(SUPPLY, zakatPool.address);
    await mirrorToken.waitForDeployment();

    // Deploy MarsDAO
    const MarsDAO = await ethers.getContractFactory("MarsDAO");
    dao = await MarsDAO.deploy(
      await marsToken.getAddress(),
      await mirrorToken.getAddress(),
      zakatPool.address,
      [council[0].address, council[1].address, council[2].address, council[3].address, council[4].address]
    );
    await dao.waitForDeployment();

    // Distribute MARS to alice and bob for voting
    const share = ethers.parseEther("10000");
    await marsToken.transfer(alice.address, share);
    await marsToken.transfer(bob.address, share);
  }

  beforeEach(deployContracts);

  // ── Deployment ──────────────────────────────────────────────────────────────

  describe("Deployment", function () {
    it("stores token addresses", async function () {
      expect(await dao.marsToken()).to.equal(await marsToken.getAddress());
      expect(await dao.mirrorToken()).to.equal(await mirrorToken.getAddress());
    });

    it("sets zakat pool", async function () {
      expect(await dao.zakatPool()).to.equal(zakatPool.address);
    });

    it("seats all 5 council members", async function () {
      for (let i = 0; i < 5; i++) {
        expect(await dao.isCouncilMember(council[i].address)).to.equal(true);
      }
    });

    it("council seats have correct term data", async function () {
      const seat = await dao.councilSeats(0);
      expect(seat.active).to.equal(true);
      expect(seat.member).to.equal(council[0].address);
      expect(seat.termEnd - seat.termStart).to.equal(BigInt(TERM_DURATION));
    });

    it("initialises 5 guilds", async function () {
      const names = ["TechGuild", "AgriGuild", "HealthGuild", "EduGuild", "CivicsGuild"];
      for (let i = 0; i < 5; i++) {
        const g = await dao.guilds(i);
        expect(g.name).to.equal(names[i]);
      }
    });

    it("reverts with zero marsToken", async function () {
      const MarsDAO = await ethers.getContractFactory("MarsDAO");
      await expect(
        MarsDAO.deploy(
          ethers.ZeroAddress,
          await mirrorToken.getAddress(),
          zakatPool.address,
          [council[0].address, council[1].address, council[2].address, council[3].address, council[4].address]
        )
      ).to.be.revertedWith("MarsDAO: zero marsToken");
    });

    it("reverts with zero mirrorToken", async function () {
      const MarsDAO = await ethers.getContractFactory("MarsDAO");
      await expect(
        MarsDAO.deploy(
          await marsToken.getAddress(),
          ethers.ZeroAddress,
          zakatPool.address,
          [council[0].address, council[1].address, council[2].address, council[3].address, council[4].address]
        )
      ).to.be.revertedWith("MarsDAO: zero mirrorToken");
    });
  });

  // ── Voting power ────────────────────────────────────────────────────────────

  describe("votingPower()", function () {
    it("returns MARS balance for linear mode", async function () {
      const bal = await marsToken.balanceOf(alice.address);
      const vp  = await dao.votingPower(alice.address, false);
      // vp = net mars balance after transfer fees + mirror/10
      expect(vp).to.be.gt(0n);
      // Mirror balance is 0, so vp should just be mars net balance
      const mirrorBal = await mirrorToken.balanceOf(alice.address);
      expect(vp).to.equal(bal + mirrorBal / 10n);
    });

    it("returns sqrt values for quadratic mode", async function () {
      const vp = await dao.votingPower(alice.address, true);
      expect(vp).to.be.gt(0n);
    });

    it("returns 0 for address with no tokens", async function () {
      expect(await dao.votingPower(carol.address, false)).to.equal(0n);
    });
  });

  // ── Standard proposal ────────────────────────────────────────────────────────

  describe("Standard proposal lifecycle", function () {
    it("creates a standard proposal", async function () {
      const tx = await dao.connect(alice).createProposal(
        TYPE_STANDARD, 0xFF, false,
        "Test Proposal", "Description text", "Qm123",
        ethers.ZeroAddress, 0, ethers.ZeroAddress
      );
      await expect(tx)
        .to.emit(dao, "ProposalCreated")
        .withArgs(1n, alice.address, TYPE_STANDARD, "Test Proposal");

      expect(await dao.proposalCount()).to.equal(1n);
      const p = await dao.proposals(1);
      expect(p.state).to.equal(STATE_ACTIVE);
      expect(p.proposalType).to.equal(TYPE_STANDARD);
    });

    it("reverts proposal from address with no governance weight", async function () {
      await expect(
        dao.connect(carol).createProposal(
          TYPE_STANDARD, 0xFF, false,
          "X", "Y", "Z",
          ethers.ZeroAddress, 0, ethers.ZeroAddress
        )
      ).to.be.revertedWith("MarsDAO: no governance weight");
    });

    it("reverts with empty title", async function () {
      await expect(
        dao.connect(alice).createProposal(
          TYPE_STANDARD, 0xFF, false,
          "", "Y", "Z",
          ethers.ZeroAddress, 0, ethers.ZeroAddress
        )
      ).to.be.revertedWith("MarsDAO: empty title");
    });

    it("castVote records votes and emits event", async function () {
      await dao.connect(alice).createProposal(
        TYPE_STANDARD, 0xFF, false, "P", "D", "H",
        ethers.ZeroAddress, 0, ethers.ZeroAddress
      );

      const weight = await dao.votingPower(alice.address, false);
      await expect(dao.connect(alice).castVote(1, 1))
        .to.emit(dao, "VoteCast")
        .withArgs(1n, alice.address, 1, weight);

      const p = await dao.proposals(1);
      expect(p.votesFor).to.equal(weight);
    });

    it("reverts double vote", async function () {
      await dao.connect(alice).createProposal(
        TYPE_STANDARD, 0xFF, false, "P", "D", "H",
        ethers.ZeroAddress, 0, ethers.ZeroAddress
      );
      await dao.connect(alice).castVote(1, 1);
      await expect(dao.connect(alice).castVote(1, 0))
        .to.be.revertedWith("MarsDAO: already voted");
    });

    it("reverts vote after voting period ends", async function () {
      await dao.connect(alice).createProposal(
        TYPE_STANDARD, 0xFF, false, "P", "D", "H",
        ethers.ZeroAddress, 0, ethers.ZeroAddress
      );
      await time.increase(VOTING_PERIOD + 1);
      await expect(dao.connect(alice).castVote(1, 1))
        .to.be.revertedWith("MarsDAO: voting ended");
    });

    it("finalises as PASSED when for > against", async function () {
      await dao.connect(alice).createProposal(
        TYPE_STANDARD, 0xFF, false, "P", "D", "H",
        ethers.ZeroAddress, 0, ethers.ZeroAddress
      );
      await dao.connect(alice).castVote(1, 1); // for
      await time.increase(VOTING_PERIOD + 1);
      await expect(dao.finaliseProposal(1))
        .to.emit(dao, "ProposalStateChanged")
        .withArgs(1n, STATE_PASSED);

      const p = await dao.proposals(1);
      expect(p.state).to.equal(STATE_PASSED);
    });

    it("finalises as REJECTED when against > for", async function () {
      await dao.connect(alice).createProposal(
        TYPE_STANDARD, 0xFF, false, "P", "D", "H",
        ethers.ZeroAddress, 0, ethers.ZeroAddress
      );
      await dao.connect(alice).castVote(1, 0); // against
      await time.increase(VOTING_PERIOD + 1);
      await dao.finaliseProposal(1);
      const p = await dao.proposals(1);
      expect(p.state).to.equal(STATE_REJECTED);
    });

    it("executes a PASSED standard proposal", async function () {
      await dao.connect(alice).createProposal(
        TYPE_STANDARD, 0xFF, false, "P", "D", "H",
        ethers.ZeroAddress, 0, ethers.ZeroAddress
      );
      await dao.connect(alice).castVote(1, 1);
      await time.increase(VOTING_PERIOD + 1);
      await dao.finaliseProposal(1);

      await expect(dao.executeProposal(1))
        .to.emit(dao, "ProposalExecuted").withArgs(1n);
      const p = await dao.proposals(1);
      expect(p.state).to.equal(STATE_EXECUTED);
    });

    it("reverts finalise before voting ends", async function () {
      await dao.connect(alice).createProposal(
        TYPE_STANDARD, 0xFF, false, "P", "D", "H",
        ethers.ZeroAddress, 0, ethers.ZeroAddress
      );
      await expect(dao.finaliseProposal(1))
        .to.be.revertedWith("MarsDAO: voting still open");
    });
  });

  // ── Treasury proposal ────────────────────────────────────────────────────────

  describe("Treasury proposal lifecycle", function () {
    let paymentAmount;

    beforeEach(async function () {
      paymentAmount = ethers.parseEther("1");
      // Fund DAO treasury
      await owner.sendTransaction({ to: await dao.getAddress(), value: paymentAmount * 2n });
    });

    it("creates treasury proposal with payment fields", async function () {
      await dao.connect(alice).createProposal(
        TYPE_TREASURY, 0xFF, false,
        "Treasury Transfer", "Pay 1 ETH to bob", "Qm456",
        bob.address, paymentAmount, ethers.ZeroAddress
      );
      const p = await dao.proposals(1);
      expect(p.proposalType).to.equal(TYPE_TREASURY);
      expect(p.paymentTarget).to.equal(bob.address);
      expect(p.paymentAmount).to.equal(paymentAmount);
    });

    it("enters TIMELOCK state after passing", async function () {
      await dao.connect(alice).createProposal(
        TYPE_TREASURY, 0xFF, false, "T", "D", "H",
        bob.address, paymentAmount, ethers.ZeroAddress
      );
      await dao.connect(alice).castVote(1, 1);
      await dao.connect(bob).castVote(1, 1);
      await time.increase(VOTING_PERIOD + 1);
      await expect(dao.finaliseProposal(1))
        .to.emit(dao, "ProposalStateChanged")
        .withArgs(1n, STATE_TIMELOCK);
    });

    it("executes treasury proposal after timelock + council multisig", async function () {
      await dao.connect(alice).createProposal(
        TYPE_TREASURY, 0xFF, false, "T", "D", "H",
        bob.address, paymentAmount, ethers.ZeroAddress
      );
      await dao.connect(alice).castVote(1, 1);
      await dao.connect(bob).castVote(1, 1);
      await time.increase(VOTING_PERIOD + 1);
      await dao.finaliseProposal(1);

      // 3 council confirmations
      await dao.connect(council[0]).councilConfirm(1);
      await dao.connect(council[1]).councilConfirm(1);
      await dao.connect(council[2]).councilConfirm(1);

      await time.increase(TIMELOCK + 1);

      const bobBefore = await ethers.provider.getBalance(bob.address);
      await expect(dao.executeProposal(1))
        .to.emit(dao, "ProposalExecuted").withArgs(1n);
      const bobAfter = await ethers.provider.getBalance(bob.address);

      // Bob received net amount (2.5% zakat deducted)
      const zakatAmt = (paymentAmount * 250n) / 10_000n;
      const net      = paymentAmount - zakatAmt;
      expect(bobAfter - bobBefore).to.equal(net);
    });

    it("reverts treasury execution before timelock expires", async function () {
      await dao.connect(alice).createProposal(
        TYPE_TREASURY, 0xFF, false, "T", "D", "H",
        bob.address, paymentAmount, ethers.ZeroAddress
      );
      await dao.connect(alice).castVote(1, 1);
      await time.increase(VOTING_PERIOD + 1);
      await dao.finaliseProposal(1);

      for (let i = 0; i < 3; i++) {
        await dao.connect(council[i]).councilConfirm(1);
      }
      // Timelock not yet expired
      await expect(dao.executeProposal(1))
        .to.be.revertedWith("MarsDAO: timelock not expired");
    });

    it("reverts treasury execution without 3 council confirmations", async function () {
      await dao.connect(alice).createProposal(
        TYPE_TREASURY, 0xFF, false, "T", "D", "H",
        bob.address, paymentAmount, ethers.ZeroAddress
      );
      await dao.connect(alice).castVote(1, 1);
      await time.increase(VOTING_PERIOD + 1);
      await dao.finaliseProposal(1);

      await dao.connect(council[0]).councilConfirm(1);
      await dao.connect(council[1]).councilConfirm(1);
      // Only 2 confirmations — not enough

      await time.increase(TIMELOCK + 1);
      await expect(dao.executeProposal(1))
        .to.be.revertedWith("MarsDAO: needs council multisig");
    });

    it("reverts treasury proposal with zero payment target", async function () {
      await expect(
        dao.connect(alice).createProposal(
          TYPE_TREASURY, 0xFF, false, "T", "D", "H",
          ethers.ZeroAddress, paymentAmount, ethers.ZeroAddress
        )
      ).to.be.revertedWith("MarsDAO: zero payment target");
    });

    it("deducts zakat from treasury disbursement", async function () {
      await dao.connect(alice).createProposal(
        TYPE_TREASURY, 0xFF, false, "T", "D", "H",
        bob.address, paymentAmount, ethers.ZeroAddress
      );
      await dao.connect(alice).castVote(1, 1);
      await time.increase(VOTING_PERIOD + 1);
      await dao.finaliseProposal(1);

      for (let i = 0; i < 3; i++) await dao.connect(council[i]).councilConfirm(1);
      await time.increase(TIMELOCK + 1);
      await dao.executeProposal(1);

      const zakatAmt = (paymentAmount * 250n) / 10_000n;
      expect(await dao.zakatAccumulated()).to.equal(zakatAmt);
    });

    it("reverts double council confirmation", async function () {
      await dao.connect(alice).createProposal(
        TYPE_TREASURY, 0xFF, false, "T", "D", "H",
        bob.address, paymentAmount, ethers.ZeroAddress
      );
      await dao.connect(council[0]).councilConfirm(1);
      await expect(dao.connect(council[0]).councilConfirm(1))
        .to.be.revertedWith("MarsDAO: already confirmed");
    });
  });

  // ── Constitutional proposal ─────────────────────────────────────────────────

  describe("Constitutional proposal", function () {
    it("passes with 67 % supermajority", async function () {
      await dao.connect(alice).createProposal(
        TYPE_CONSTITUTIONAL, 0xFF, false, "Constitution", "D", "H",
        ethers.ZeroAddress, 0, ethers.ZeroAddress
      );

      // Alice votes for, bob votes against — alice has more tokens
      await dao.connect(alice).castVote(1, 1);   // large for
      await time.increase(VOTING_PERIOD + 1);
      await dao.finaliseProposal(1);
      // With only alice's votes (100% for), should pass
      const p = await dao.proposals(1);
      expect(p.state).to.equal(STATE_PASSED);
    });

    it("fails with less than 67 % majority", async function () {
      await dao.connect(alice).createProposal(
        TYPE_CONSTITUTIONAL, 0xFF, false, "Constitution", "D", "H",
        ethers.ZeroAddress, 0, ethers.ZeroAddress
      );

      // Cast roughly equal votes for and against
      await dao.connect(alice).castVote(1, 1); // for
      await dao.connect(bob).castVote(1, 0);   // against (bob has similar balance)
      await time.increase(VOTING_PERIOD + 1);
      await dao.finaliseProposal(1);

      const p = await dao.proposals(1);
      // ~50/50 is < 67 %, should reject
      expect(p.state).to.equal(STATE_REJECTED);
    });
  });

  // ── Emergency proposal ───────────────────────────────────────────────────────

  describe("Emergency proposal", function () {
    it("council member can create emergency proposal", async function () {
      await expect(
        dao.connect(council[0]).createProposal(
          TYPE_EMERGENCY, 0xFF, false, "Emergency Fix", "D", "H",
          ethers.ZeroAddress, 0, ethers.ZeroAddress
        )
      ).to.emit(dao, "ProposalCreated");
    });

    it("non-council cannot create emergency proposal", async function () {
      await expect(
        dao.connect(alice).createProposal(
          TYPE_EMERGENCY, 0xFF, false, "E", "D", "H",
          ethers.ZeroAddress, 0, ethers.ZeroAddress
        )
      ).to.be.revertedWith("MarsDAO: emergency needs council");
    });

    it("emergency voting window is 24 hours", async function () {
      await dao.connect(council[0]).createProposal(
        TYPE_EMERGENCY, 0xFF, false, "E", "D", "H",
        ethers.ZeroAddress, 0, ethers.ZeroAddress
      );
      const p       = await dao.proposals(1);
      const window  = p.votingEnds - p.createdAt;
      expect(window).to.equal(BigInt(24 * 3600));
    });

    it("executes emergency proposal after ratification + council multisig", async function () {
      await dao.connect(council[0]).createProposal(
        TYPE_EMERGENCY, 0xFF, false, "E", "D", "H",
        ethers.ZeroAddress, 0, ethers.ZeroAddress
      );

      await dao.connect(alice).castVote(1, 1); // community ratification
      await time.increase(24 * 3600 + 1);
      await dao.finaliseProposal(1);

      for (let i = 0; i < 3; i++) await dao.connect(council[i]).councilConfirm(1);

      await expect(dao.executeProposal(1))
        .to.emit(dao, "ProposalExecuted").withArgs(1n);
    });
  });

  // ── Recall mechanism ─────────────────────────────────────────────────────────

  describe("Recall mechanism", function () {
    it("initiates a recall vote", async function () {
      await expect(dao.connect(alice).initiateRecall(0))
        .to.emit(dao, "RecallVoteStarted")
        .withArgs(1n, 0n);
    });

    it("reverts recall initiation with no governance weight", async function () {
      await expect(dao.connect(carol).initiateRecall(0))
        .to.be.revertedWith("MarsDAO: no governance weight");
    });

    it("removes council member when recall passes", async function () {
      await dao.connect(alice).initiateRecall(0);

      await dao.connect(alice).voteRecall(1, true); // vote to recall
      // Bob votes to recall too
      await dao.connect(bob).voteRecall(1, true);

      await time.increase(VOTING_PERIOD + 1);
      await expect(dao.finaliseRecall(1))
        .to.emit(dao, "RecallExecuted")
        .withArgs(1n, 0n);

      expect(await dao.isCouncilMember(council[0].address)).to.equal(false);
    });

    it("keeps council member when recall fails", async function () {
      await dao.connect(alice).initiateRecall(0);

      await dao.connect(alice).voteRecall(1, false); // vote to keep
      await time.increase(VOTING_PERIOD + 1);
      await dao.finaliseRecall(1);

      expect(await dao.isCouncilMember(council[0].address)).to.equal(true);
    });

    it("reverts recall vote after period ends", async function () {
      await dao.connect(alice).initiateRecall(0);
      await time.increase(VOTING_PERIOD + 1);
      await expect(dao.connect(alice).voteRecall(1, true))
        .to.be.revertedWith("MarsDAO: recall vote ended");
    });

    it("reverts double recall vote", async function () {
      await dao.connect(alice).initiateRecall(0);
      await dao.connect(alice).voteRecall(1, true);
      await expect(dao.connect(alice).voteRecall(1, false))
        .to.be.revertedWith("MarsDAO: already voted");
    });

    it("getRecallVote returns correct data", async function () {
      await dao.connect(alice).initiateRecall(2);
      const [seatIdx, votesFor, votesAgainst, votingEnds, executed] =
        await dao.getRecallVote(1);
      expect(seatIdx).to.equal(2n);
      expect(executed).to.equal(false);
    });
  });

  // ── Guilds ───────────────────────────────────────────────────────────────────

  describe("Guilds", function () {
    it("token holder can join a guild", async function () {
      await expect(dao.connect(alice).joinGuild(GUILD_TECH))
        .to.emit(dao, "GuildMemberAdded")
        .withArgs(GUILD_TECH, alice.address);

      expect(await dao.guildOf(alice.address)).to.equal(GUILD_TECH);
    });

    it("reverts joining guild with no MARS tokens", async function () {
      await expect(dao.connect(carol).joinGuild(GUILD_AGRI))
        .to.be.revertedWith("MarsDAO: no MARS to join guild");
    });

    it("reverts joining a second guild", async function () {
      await dao.connect(alice).joinGuild(GUILD_TECH);
      await expect(dao.connect(alice).joinGuild(GUILD_AGRI))
        .to.be.revertedWith("MarsDAO: already in a guild");
    });

    it("reverts guildOf for non-member", async function () {
      await expect(dao.guildOf(carol.address))
        .to.be.revertedWith("MarsDAO: not a guild member");
    });

    it("council can set guild lead", async function () {
      await expect(dao.connect(council[0]).setGuildLead(GUILD_HEALTH, alice.address))
        .to.emit(dao, "GuildLeadUpdated")
        .withArgs(GUILD_HEALTH, alice.address);
      const g = await dao.guilds(GUILD_HEALTH);
      expect(g.lead).to.equal(alice.address);
    });

    it("owner can set guild lead", async function () {
      await expect(dao.setGuildLead(GUILD_EDU, bob.address))
        .to.emit(dao, "GuildLeadUpdated")
        .withArgs(GUILD_EDU, bob.address);
    });

    it("random address cannot set guild lead", async function () {
      await expect(dao.connect(alice).setGuildLead(GUILD_TECH, carol.address))
        .to.be.revertedWith("MarsDAO: not authorised");
    });

    it("guild memberCount increments on join", async function () {
      await dao.connect(alice).joinGuild(GUILD_CIVICS);
      const g = await dao.guilds(GUILD_CIVICS);
      expect(g.memberCount).to.equal(1n);
    });
  });

  // ── Health metrics ───────────────────────────────────────────────────────────

  describe("healthMetrics()", function () {
    it("returns correct pass rate after proposals", async function () {
      // Create + pass proposal 1
      await dao.connect(alice).createProposal(TYPE_STANDARD, 0xFF, false, "P1", "D", "H", ethers.ZeroAddress, 0, ethers.ZeroAddress);
      await dao.connect(alice).castVote(1, 1);
      await time.increase(VOTING_PERIOD + 1);
      await dao.finaliseProposal(1);

      // Create + reject proposal 2
      await dao.connect(alice).createProposal(TYPE_STANDARD, 0xFF, false, "P2", "D", "H", ethers.ZeroAddress, 0, ethers.ZeroAddress);
      await dao.connect(alice).castVote(2, 0); // against
      await time.increase(VOTING_PERIOD + 1);
      await dao.finaliseProposal(2);

      const metrics = await dao.healthMetrics();
      expect(metrics._totalProposals).to.equal(2n);
      expect(metrics._passed).to.equal(1n);
      expect(metrics._rejected).to.equal(1n);
      expect(metrics._passRate).to.equal(5000n); // 50%
    });

    it("tracks vote counts", async function () {
      await dao.connect(alice).createProposal(TYPE_STANDARD, 0xFF, false, "P", "D", "H", ethers.ZeroAddress, 0, ethers.ZeroAddress);
      await dao.connect(alice).castVote(1, 1);
      await dao.connect(bob).castVote(1, 1);
      const metrics = await dao.healthMetrics();
      expect(metrics._totalVotes).to.equal(2n);
    });
  });

  // ── Cross-DAO ────────────────────────────────────────────────────────────────

  describe("Cross-DAO registry", function () {
    it("owner can register an external DAO", async function () {
      await expect(dao.registerExternalDAO("SolarDAO", bob.address))
        .to.emit(dao, "ExternalDAORegistered")
        .withArgs(1n, "SolarDAO", bob.address);

      const d = await dao.externalDAOs(1);
      expect(d.name).to.equal("SolarDAO");
      expect(d.daoAddress).to.equal(bob.address);
      expect(d.active).to.equal(true);
    });

    it("non-owner cannot register external DAO", async function () {
      await expect(dao.connect(alice).registerExternalDAO("X", bob.address))
        .to.be.revertedWith("MarsDAO: caller is not owner");
    });
  });

  // ── Participation rewards ────────────────────────────────────────────────────

  describe("Participation rewards", function () {
    it("owner can set participation reward rate", async function () {
      const reward = ethers.parseEther("1");
      await dao.setParticipationReward(reward);
      expect(await dao.participationRewardPerVote()).to.equal(reward);
    });

    it("voting accrues participation reward", async function () {
      await dao.setParticipationReward(ethers.parseEther("1"));
      await dao.connect(alice).createProposal(
        TYPE_STANDARD, 0xFF, false, "P", "D", "H",
        ethers.ZeroAddress, 0, ethers.ZeroAddress
      );
      await dao.connect(alice).castVote(1, 1);
      expect(await dao.participationRewards(alice.address)).to.equal(ethers.parseEther("1"));
    });
  });

  // ── Treasury deposit ─────────────────────────────────────────────────────────

  describe("DAO Treasury", function () {
    it("accepts native token deposits", async function () {
      const amount = ethers.parseEther("5");
      await expect(
        owner.sendTransaction({ to: await dao.getAddress(), value: amount })
      ).to.emit(dao, "TreasuryDeposit").withArgs(owner.address, amount);
      expect(await dao.daoTreasuryBalance()).to.equal(amount);
    });
  });

  // ── Admin ─────────────────────────────────────────────────────────────────────

  describe("Admin", function () {
    it("owner can update zakat pool", async function () {
      await dao.setZakatPool(alice.address);
      expect(await dao.zakatPool()).to.equal(alice.address);
    });

    it("setZakatPool reverts on zero address", async function () {
      await expect(dao.setZakatPool(ethers.ZeroAddress))
        .to.be.revertedWith("MarsDAO: zero address");
    });

    it("owner can reseat council member", async function () {
      await expect(dao.seatCouncilMember(0, carol.address))
        .to.emit(dao, "CouncilMemberSeated")
        .withArgs(0n, carol.address);
      expect(await dao.isCouncilMember(carol.address)).to.equal(true);
    });

    it("transferOwnership works", async function () {
      await expect(dao.transferOwnership(alice.address))
        .to.emit(dao, "OwnershipTransferred")
        .withArgs(owner.address, alice.address);
      expect(await dao.owner()).to.equal(alice.address);
    });

    it("transferOwnership reverts on zero address", async function () {
      await expect(dao.transferOwnership(ethers.ZeroAddress))
        .to.be.revertedWith("MarsDAO: zero address");
    });

    it("non-owner cannot update zakat pool", async function () {
      await expect(dao.connect(alice).setZakatPool(bob.address))
        .to.be.revertedWith("MarsDAO: caller is not owner");
    });
  });

  // ── Quadratic voting ──────────────────────────────────────────────────────────

  describe("Quadratic voting", function () {
    it("quadratic proposal uses sqrt voting weights", async function () {
      await dao.connect(alice).createProposal(
        TYPE_STANDARD, 0xFF, true, // quadratic = true
        "QV Proposal", "D", "H",
        ethers.ZeroAddress, 0, ethers.ZeroAddress
      );
      const p      = await dao.proposals(1);
      expect(p.quadraticVoting).to.equal(true);

      const linearVP    = await dao.votingPower(alice.address, false);
      const quadraticVP = await dao.votingPower(alice.address, true);
      // sqrt(large balance) << linear balance
      expect(quadraticVP).to.be.lt(linearVP);
    });
  });
});
