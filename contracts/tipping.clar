;; tipping.clar
;; Core Tipping Contract for ArtistTip: Handles direct tipping in STX or custom tokens.
;; Expanded for sophistication: Supports STX and SIP-10 tokens, tip history, refunds, batch tipping,
;; tipping events, minimum tip amounts, fee-on-tip (optional for platform sustainability),
;; integration with registry, and read-only analytics.

(use-trait user-trait .registry.user-trait)
(use-trait ft-trait 'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.sip-010-trait-ft-standard.sip-010-trait)

(define-constant ERR-NOT-REGISTERED u100)
(define-constant ERR-INVALID-AMOUNT u101)
(define-constant ERR-NOT-AUTHORIZED u102)
(define-constant ERR-INSUFFICIENT-BALANCE u103)
(define-constant ERR-TIP-NOT-FOUND u104)
(define-constant ERR-REFUND-NOT-ALLOWED u105)
(define-constant ERR-PAUSED u106)
(define-constant ERR-INVALID-TOKEN u107)
(define-constant ERR-BATCH-LIMIT-EXCEEDED u108)
(define-constant MAX-BATCH-SIZE u10)

(define-data-var contract-owner principal tx-sender)
(define-data-var paused bool false)
(define-data-var min-tip-amount uint u100) ;; Minimum tip in micro-STX or token units
(define-data-var platform-fee-percent uint u5) ;; 0.5% fee, out of 1000 for precision

(define-map tips {tip-id: uint} {tipper: principal, artist: principal, amount: uint, token: (optional principal), timestamp: uint, refunded: bool})
(define-map tip-history-by-tipper principal (list 100 uint)) ;; List of tip-ids per tipper
(define-map tip-history-by-artist principal (list 100 uint)) ;; List of tip-ids per artist
(define-map total-tips-received principal uint)
(define-map total-tips-sent principal uint)
(define-data-var tip-counter uint u0)

(define-map tipping-events {event-id: uint} {artist: principal, start-height: uint, end-height: uint, total-tipped: uint})
(define-data-var event-counter uint u0)

(define-public (set-paused (new-paused bool))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) (err ERR-NOT-AUTHORIZED))
    (var-set paused new-paused)
    (ok true)
  )
)

(define-public (set-min-tip-amount (new-min uint))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) (err ERR-NOT-AUTHORIZED))
    (var-set min-tip-amount new-min)
    (ok true)
  )
)

(define-public (set-platform-fee-percent (new-percent uint))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) (err ERR-NOT-AUTHORIZED))
    (asserts! (<= new-percent u100) (err ERR-INVALID-AMOUNT)) ;; Max 10%
    (var-set platform-fee-percent new-percent)
    (ok true)
  )
)

(define-public (send-tip-stx (artist principal) (amount uint) (registry <user-trait>))
  (let (
    (artist-info (unwrap! (contract-call? registry get-user artist) (err ERR-NOT-REGISTERED)))
    (tip-id (var-get tip-counter))
    (fee (/ (* amount (var-get platform-fee-percent)) u1000))
    (net-amount (- amount fee))
  )
    (asserts! (not (var-get paused)) (err ERR-PAUSED))
    (asserts! (is-eq (get role artist-info) "artist") (err ERR-NOT-REGISTERED))
    (asserts! (>= amount (var-get min-tip-amount)) (err ERR-INVALID-AMOUNT))
    (try! (stx-transfer? fee tx-sender (var-get contract-owner))) ;; Platform fee
    (try! (stx-transfer? net-amount tx-sender artist))
    (map-set tips {tip-id: tip-id} {tipper: tx-sender, artist: artist, amount: amount, token: none, timestamp: block-height, refunded: false})
    (map-set tip-history-by-tipper tx-sender (unwrap-panic (as-max-len? (append (unwrap-panic (map-get? tip-history-by-tipper tx-sender)) tip-id) u100)))
    (map-set tip-history-by-artist artist (unwrap-panic (as-max-len? (append (unwrap-panic (map-get? tip-history-by-artist artist)) tip-id) u100)))
    (map-set total-tips-received artist (+ (default-to u0 (map-get? total-tips-received artist)) net-amount))
    (map-set total-tips-sent tx-sender (+ (default-to u0 (map-get? total-tips-sent tx-sender)) amount))
    (var-set tip-counter (+ tip-id u1))
    (ok tip-id)
  )
)

(define-public (send-tip-token (artist principal) (amount uint) (token <ft-trait>) (registry <user-trait>))
  (let (
    (artist-info (unwrap! (contract-call? registry get-user artist) (err ERR-NOT-REGISTERED)))
    (tip-id (var-get tip-counter))
    (fee (/ (* amount (var-get platform-fee-percent)) u1000))
    (net-amount (- amount fee))
    (token-principal (contract-of token))
  )
    (asserts! (not (var-get paused)) (err ERR-PAUSED))
    (asserts! (is-eq (get role artist-info) "artist") (err ERR-NOT-REGISTERED))
    (asserts! (>= amount (var-get min-tip-amount)) (err ERR-INVALID-AMOUNT))
    (try! (contract-call? token transfer fee tx-sender (var-get contract-owner) none)) ;; Platform fee
    (try! (contract-call? token transfer net-amount tx-sender artist none))
    (map-set tips {tip-id: tip-id} {tipper: tx-sender, artist: artist, amount: amount, token: (some token-principal), timestamp: block-height, refunded: false})
    (map-set tip-history-by-tipper tx-sender (unwrap-panic (as-max-len? (append (unwrap-panic (map-get? tip-history-by-tipper tx-sender)) tip-id) u100)))
    (map-set tip-history-by-artist artist (unwrap-panic (as-max-len? (append (unwrap-panic (map-get? tip-history-by-artist artist)) tip-id) u100)))
    (map-set total-tips-received artist (+ (default-to u0 (map-get? total-tips-received artist)) net-amount))
    (map-set total-tips-sent tx-sender (+ (default-to u0 (map-get? total-tips-sent tx-sender)) amount))
    (var-set tip-counter (+ tip-id u1))
    (ok tip-id)
  )
)

(define-public (batch-send-tip-stx (artists (list 10 principal)) (amounts (list 10 uint)) (registry <user-trait>))
  (let (
    (total-amount (fold + amounts u0))
  )
    (asserts! (not (var-get paused)) (err ERR-PAUSED))
    (asserts! (<= (len artists) MAX-BATCH-SIZE) (err ERR-BATCH-LIMIT-EXCEEDED))
    (asserts! (is-eq (len artists) (len amounts)) (err ERR-INVALID-AMOUNT))
    (fold batch-tip-stx-iter (zip artists amounts) {success: true, registry: registry})
    (ok true)
  )
)

(define-private (batch-tip-stx-iter (entry {artist: principal, amount: uint}) (state {success: bool, registry: <user-trait>}))
  (if (get success state)
    (match (send-tip-stx (get artist entry) (get amount entry) (get registry state))
      success (merge state {success: true})
      error (merge state {success: false})
    )
    state
  )
)

(define-public (refund-tip (tip-id uint))
  (let (
    (tip (unwrap! (map-get? tips {tip-id: tip-id}) (err ERR-TIP-NOT-FOUND)))
    (net-amount (- (get amount tip) (/ (* (get amount tip) (var-get platform-fee-percent)) u1000)))
  )
    (asserts! (is-eq tx-sender (get tipper tip)) (err ERR-NOT-AUTHORIZED))
    (asserts! (not (get refunded tip)) (err ERR-REFUND-NOT-ALLOWED))
    (asserts! (< block-height (+ (get timestamp tip) u144)) (err ERR-REFUND-NOT-ALLOWED)) ;; 24 hours refund window
    (if (is-none (get token tip))
      (try! (as-contract (stx-transfer? net-amount tx-sender (get tipper tip))))
      (let ((token (unwrap-panic (get token tip))))
        (try! (as-contract (contract-call? (unwrap-panic (as-contract (contract-of token))) transfer net-amount tx-sender (get tipper tip) none)))
      )
    )
    (map-set tips {tip-id: tip-id} (merge tip {refunded: true}))
    (map-set total-tips-received (get artist tip) (- (default-to u0 (map-get? total-tips-received (get artist tip))) net-amount))
    (map-set total-tips-sent (get tipper tip) (- (default-to u0 (map-get? total-tips-sent (get tipper tip))) (get amount tip)))
    (ok true)
  )
)

(define-public (create-tipping-event (artist principal) (duration uint) (registry <user-trait>))
  (let (
    (artist-info (unwrap! (contract-call? registry get-user artist) (err ERR-NOT-REGISTERED)))
    (event-id (var-get event-counter))
  )
    (asserts! (is-eq (get role artist-info) "artist") (err ERR-NOT-REGISTERED))
    (asserts! (is-eq tx-sender artist) (err ERR-NOT-AUTHORIZED))
    (map-set tipping-events {event-id: event-id} {artist: artist, start-height: block-height, end-height: (+ block-height duration), total-tipped: u0})
    (var-set event-counter (+ event-id u1))
    (ok event-id)
  )
)

(define-private (update-event-total (artist principal) (amount uint))
  (let (
    (events (filter (lambda (event-id) 
      (let ((event (map-get? tipping-events {event-id: event-id})))
        (and 
          (is-some event)
          (is-eq (get artist (unwrap-panic event)) artist)
          (>= block-height (get start-height (unwrap-panic event)))
          (<= block-height (get end-height (unwrap-panic event)))
        )
      )) (unwrap-panic (as-max-len? (list 0 1 2 3 4 5 6 7 8 9) u10)))) ;; Dummy, in real would search
  )
    (fold update-event-iter events amount)
  )
)

(define-private (update-event-iter (event-id uint) (total uint))
  (let ((event (unwrap-panic (map-get? tipping-events {event-id: event-id}))))
    (map-set tipping-events {event-id: event-id} (merge event {total-tipped: (+ (get total-tipped event) total)}))
    total
  )
)

(define-read-only (get-tip (tip-id uint))
  (map-get? tips {tip-id: tip-id})
)

(define-read-only (get-tip-history-by-tipper (tipper principal))
  (map-get? tip-history-by-tipper tipper)
)

(define-read-only (get-tip-history-by-artist (artist principal))
  (map-get? tip-history-by-artist artist)
)

(define-read-only (get-total-tips-received (artist principal))
  (default-to u0 (map-get? total-tips-received artist))
)

(define-read-only (get-total-tips-sent (tipper principal))
  (default-to u0 (map-get? total-tips-sent tipper))
)

(define-read-only (get-tipping-event (event-id uint))
  (map-get? tipping-events {event-id: event-id})
)

(define-read-only (is-paused)
  (var-get paused)
)

(define-read-only (get-min-tip-amount)
  (var-get min-tip-amount)
)

(define-read-only (get-platform-fee-percent)
  (var-get platform-fee-percent)
)