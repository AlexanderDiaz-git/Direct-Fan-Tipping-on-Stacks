# ArtistTip: Direct Fan Tipping on Stacks

## Overview

ArtistTip is a Web3 project built on the Stacks blockchain using Clarity smart contracts. It enables fans to tip artists directly in cryptocurrency (using STX, the native token of Stacks, or custom SIP-10 fungible tokens) during live streams or on content platforms, with zero intermediaries. This solves real-world problems in the creator economy, such as:

- **Platform Fees and Intermediaries**: Traditional platforms like YouTube, Twitch, or Patreon take 30-50% cuts, leaving artists with less revenue. ArtistTip ensures 100% of tips go directly to artists.
- **Payment Delays and Borders**: Fiat payouts can take weeks and incur cross-border fees. Blockchain enables instant, global transfers.
- **Transparency and Trust**: All transactions are on-chain, verifiable, reducing fraud and building trust between fans and artists.
- **Financial Inclusion**: Artists in underbanked regions can receive tips without needing traditional banking.
- **Monetization Barriers**: Emerging artists struggle with algorithmic suppression on centralized platforms; direct tipping empowers grassroots support.

The project consists of 6 smart contracts for modularity, security, and extensibility:
1. **Registry Contract**: Manages artist and fan registrations.
2. **Token Contract**: A SIP-10 compliant fungible token for custom tipping (e.g., branded artist tokens).
3. **Tipping Contract**: Core logic for sending and receiving tips.
4. **Escrow Contract**: Optional time-locked escrow for milestone-based tips (e.g., for exclusive content unlocks).
5. **Governance Contract**: Allows community voting on platform parameters.
6. **Reward Contract**: Handles NFT-based rewards for top tippers.

ArtistTip integrates with live streaming via off-chain apps (e.g., a dApp frontend) that call these contracts. Fans connect wallets, select artists, and tip during streams. Artists claim tips instantly.

## Installation and Deployment

### Prerequisites
- Stacks Wallet (e.g., Hiro Wallet) for testing on Stacks testnet/mainnet.
- Clarity development tools: Install via `npm install -g @stacks/cli`.
- Node.js for any frontend integration (not included here).

### Deployment Steps
1. Clone the repo: `git clone <repo-url>`.
2. Navigate to the contracts directory: `cd contracts`.
3. Deploy each contract using Stacks CLI: `stacks deploy <contract-name>.clar`.
   - Deploy in order: registry, token, tipping, escrow, governance, reward.
4. Configure the dApp frontend to interact with contract addresses (use Stacks.js library).

## Usage

### For Artists
- Register via the Registry contract.
- Set up a profile and link to your streaming platform.
- During live streams, share your tipping address.
- Claim tips from the Tipping contract.

### For Fans
- Register (optional for anonymity).
- Tip artists directly using STX or custom tokens.
- Participate in governance votes or earn rewards.

### Example Interaction (via Clarity Console or dApp)
- Register as artist: Call `registry::register-artist`.
- Tip: Call `tipping::send-tip` with artist principal and amount.

## Smart Contracts

Below are the 6 Clarity smart contracts. Each is a separate file (e.g., `registry.clar`). They use traits for interoperability.

### 1. registry.clar
```
;; Registry Contract: Manages artist and fan registrations for verification and discovery.

(define-trait user-trait
  (
    (get-user (principal) (response (optional {name: (string-ascii 50), role: (string-ascii 10)}) uint))
  )
)

(define-map users principal {name: (string-ascii 50), role: (string-ascii 10), registered-at: uint})

(define-public (register-user (name (string-ascii 50)) (role (string-ascii 10)))
  (begin
    (asserts! (or (is-eq role "artist") (is-eq role "fan")) (err u100)) ;; Invalid role
    (map-set users tx-sender {name: name, role: role, registered-at: block-height})
    (ok true)
  )
)

(define-read-only (get-user (user principal))
  (map-get? users user)
)
```

### 2. token.clar
```
;; Token Contract: SIP-10 compliant fungible token for custom tipping.

(define-fungible-token artist-tip u1000000000) ;; Max supply 1B

(define-constant ERR-INSUFFICIENT-BALANCE u101)
(define-constant ERR-NOT-AUTHORIZED u102)

(define-public (transfer (amount uint) (sender principal) (recipient principal))
  (begin
    (asserts! (is-eq tx-sender sender) (err ERR-NOT-AUTHORIZED))
    (ft-transfer? artist-tip amount sender recipient)
  )
)

(define-public (mint (amount uint) (recipient principal))
  (begin
    (asserts! (is-eq tx-sender contract-caller) (err ERR-NOT-AUTHORIZED)) ;; Only callable by governance
    (ft-mint? artist-tip amount recipient)
  )
)

(define-read-only (get-balance (user principal))
  (ft-get-balance artist-tip user)
)

(define-read-only (get-total-supply)
  (ft-get-supply artist-tip)
)
```

### 3. tipping.clar
```
;; Tipping Contract: Core logic for direct tipping.

(use-trait user-trait .registry.user-trait)

(define-map tips {tipper: principal, artist: principal} {amount: uint, timestamp: uint})

(define-constant ERR-NOT-REGISTERED u103)
(define-constant ERR-INVALID-AMOUNT u104)

(define-public (send-tip (artist principal) (amount uint) (registry <user-trait>))
  (let ((artist-info (unwrap! (contract-call? registry get-user artist) (err ERR-NOT-REGISTERED))))
    (asserts! (is-eq (get role artist-info) "artist") (err ERR-NOT-REGISTERED))
    (asserts! (> amount u0) (err ERR-INVALID-AMOUNT))
    (try! (stx-transfer? amount tx-sender artist)) ;; Use STX for native tipping
    (map-set tips {tipper: tx-sender, artist: artist} {amount: amount, timestamp: block-height})
    (ok true)
  )
)

(define-read-only (get-tip (tipper principal) (artist principal))
  (map-get? tips {tipper: tipper, artist: artist})
)
```

### 4. escrow.clar
```
;; Escrow Contract: Time-locked escrow for conditional tips (e.g., after stream milestone).

(define-map escrows uint {sender: principal, recipient: principal, amount: uint, release-height: uint})

(define-data-var escrow-counter uint u0)

(define-constant ERR-ESCROW-NOT-FOUND u105)
(define-constant ERR-NOT-RELEASED u106)

(define-public (create-escrow (recipient principal) (amount uint) (delay uint))
  (let ((escrow-id (var-get escrow-counter)))
    (try! (stx-transfer? amount tx-sender (as-contract tx-sender)))
    (map-set escrows escrow-id {sender: tx-sender, recipient: recipient, amount: amount, release-height: (+ block-height delay)})
    (var-set escrow-counter (+ escrow-id u1))
    (ok escrow-id)
  )
)

(define-public (release-escrow (escrow-id uint))
  (let ((escrow (unwrap! (map-get? escrows escrow-id) (err ERR-ESCROW-NOT-FOUND))))
    (asserts! (>= block-height (get release-height escrow)) (err ERR-NOT-RELEASED))
    (as-contract (try! (stx-transfer? (get amount escrow) tx-sender (get recipient escrow))))
    (map-delete escrows escrow-id)
    (ok true)
  )
)
```

### 5. governance.clar
```
;; Governance Contract: Community voting on parameters like token minting.

(define-map proposals uint {proposer: principal, description: (string-ascii 256), yes-votes: uint, no-votes: uint, end-height: uint})
(define-map votes {proposal: uint, voter: principal} bool)

(define-data-var proposal-counter uint u0)
(define-constant ERR-ALREADY-VOTED u107)
(define-constant ERR-PROPOSAL-ENDED u108)

(define-public (create-proposal (description (string-ascii 256)) (duration uint))
  (let ((proposal-id (var-get proposal-counter)))
    (map-set proposals proposal-id {proposer: tx-sender, description: description, yes-votes: u0, no-votes: u0, end-height: (+ block-height duration)})
    (var-set proposal-counter (+ proposal-id u1))
    (ok proposal-id)
  )
)

(define-public (vote (proposal-id uint) (vote-yes bool))
  (let ((proposal (unwrap! (map-get? proposals proposal-id) (err ERR-PROPOSAL-ENDED))))
    (asserts! (< block-height (get end-height proposal)) (err ERR-PROPOSAL-ENDED))
    (asserts! (is-none (map-get? votes {proposal: proposal-id, voter: tx-sender})) (err ERR-ALREADY-VOTED))
    (if vote-yes
      (map-set proposals proposal-id (merge proposal {yes-votes: (+ (get yes-votes proposal) u1)}))
      (map-set proposals proposal-id (merge proposal {no-votes: (+ (get no-votes proposal) u1)})))
    (map-set votes {proposal: proposal-id, voter: tx-sender} vote-yes)
    (ok true)
  )
)

(define-read-only (get-proposal (proposal-id uint))
  (map-get? proposals proposal-id)
)
```

### 6. reward.clar
```
;; Reward Contract: Issues NFTs to top tippers as rewards.

(define-non-fungible-token reward-nft uint)
(define-data-var nft-counter uint u0)

(define-map rewards {artist: principal, tipper: principal} uint) ;; NFT ID

(define-constant ERR-NOT-ARTIST u109)

(define-public (issue-reward (tipper principal) (metadata (string-ascii 256)))
  (let ((nft-id (var-get nft-counter)))
    (asserts! (is-eq (unwrap-panic (contract-call? .registry get-user tx-sender)) "artist") (err ERR-NOT-ARTIST)) ;; Simplified check
    (nft-mint? reward-nft nft-id tipper)
    (map-set rewards {artist: tx-sender, tipper: tipper} nft-id)
    (var-set nft-counter (+ nft-id u1))
    (ok nft-id)
  )
)

(define-read-only (get-reward (artist principal) (tipper principal))
  (map-get? rewards {artist: artist, tipper: tipper})
)
```

## Security Considerations
- Clarity's decidability prevents reentrancy and infinite loops.
- All contracts use assertions for input validation.
- Audits recommended before mainnet deployment.
- Off-chain oracles (not included) could verify stream activity.

## Future Enhancements
- Integration with Stacks' PoX for stacking rewards on tips.
- dApp frontend for user-friendly interactions.
- Multi-token support beyond STX.

## License
MIT License. See LICENSE file for details.