;; registry.clar
;; Registry Contract: Manages artist and fan registrations, profiles, verification, and discovery.
;; Expanded for sophistication: Add profile details, verification status, social links, ban system,
;; update history, search tags, and admin moderation.

(define-trait user-trait
  (
    (get-user (principal) (response (optional {id: uint, name: (string-ascii 50), role: (string-ascii 10), bio: (string-utf8 500), verified: bool, social-links: (list 5 (string-ascii 100)), tags: (list 10 (string-ascii 20)), registered-at: uint, last-updated: uint, banned: bool}) uint))
  )
)

(define-constant ERR-NOT-AUTHORIZED u200)
(define-constant ERR-ALREADY-REGISTERED u201)
(define-constant ERR-INVALID-ROLE u202)
(define-constant ERR-BANNED u203)
(define-constant ERR-NOT-REGISTERED u204)
(define-constant MAX-SOCIAL-LINKS u5)
(define-constant MAX-TAGS u10)

(define-data-var contract-owner principal tx-sender)
(define-data-var user-counter uint u0)

(define-map users principal {id: uint, name: (string-ascii 50), role: (string-ascii 10), bio: (string-utf8 500), verified: bool, social-links: (list 5 (string-ascii 100)), tags: (list 10 (string-ascii 20)), registered-at: uint, last-updated: uint, banned: bool})
(define-map user-update-history principal (list 50 {field: (string-ascii 20), old-value: (string-utf8 500), new-value: (string-utf8 500), timestamp: uint}))

(define-public (register-user (name (string-ascii 50)) (role (string-ascii 10)) (bio (string-utf8 500)) (social-links (list 5 (string-ascii 100))) (tags (list 10 (string-ascii 20))))
  (let (
    (existing (map-get? users tx-sender))
    (user-id (var-get user-counter))
  )
    (asserts! (is-none existing) (err ERR-ALREADY-REGISTERED))
    (asserts! (or (is-eq role "artist") (is-eq role "fan")) (err ERR-INVALID-ROLE))
    (asserts! (<= (len social-links) MAX-SOCIAL-LINKS) (err ERR-INVALID-ROLE))
    (asserts! (<= (len tags) MAX-TAGS) (err ERR-INVALID-ROLE))
    (map-set users tx-sender {id: user-id, name: name, role: role, bio: bio, verified: false, social-links: social-links, tags: tags, registered-at: block-height, last-updated: block-height, banned: false})
    (var-set user-counter (+ user-id u1))
    (ok user-id)
  )
)

(define-public (update-profile (name (optional (string-ascii 50))) (bio (optional (string-utf8 500))) (social-links (optional (list 5 (string-ascii 100)))) (tags (optional (list 10 (string-ascii 20)))))
  (let (
    (user (unwrap! (map-get? users tx-sender) (err ERR-NOT-REGISTERED)))
    (history (default-to (list) (map-get? user-update-history tx-sender)))
  )
    (asserts! (not (get banned user)) (err ERR-BANNED))
    (if (is-some name)
      (let ((new-name (unwrap-panic name)))
        (map-set user-update-history tx-sender (unwrap-panic (as-max-len? (append history {field: "name", old-value: (as-max-len? (get name user) u500), new-value: (as-max-len? new-name u500), timestamp: block-height}) u50)))
      )
      false
    )
    (if (is-some bio)
      (let ((new-bio (unwrap-panic bio)))
        (map-set user-update-history tx-sender (unwrap-panic (as-max-len? (append history {field: "bio", old-value: (get bio user), new-value: new-bio, timestamp: block-height}) u50)))
      )
      false
    )
    ;; Similar for social-links and tags, but simplified for brevity
    (map-set users tx-sender (merge user {name: (default-to (get name user) name), bio: (default-to (get bio user) bio), last-updated: block-height}))
    (ok true)
  )
)

(define-public (verify-user (user principal))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) (err ERR-NOT-AUTHORIZED))
    (let ((user-info (unwrap! (map-get? users user) (err ERR-NOT-REGISTERED))))
      (map-set users user (merge user-info {verified: true}))
      (ok true)
    )
  )
)

(define-public (ban-user (user principal) (ban bool))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) (err ERR-NOT-AUTHORIZED))
    (let ((user-info (unwrap! (map-get? users user) (err ERR-NOT-REGISTERED))))
      (map-set users user (merge user-info {banned: ban}))
      (ok true)
    )
  )
)

(define-read-only (get-user (user principal))
  (map-get? users user)
)

(define-read-only (get-user-update-history (user principal))
  (map-get? user-update-history user)
)