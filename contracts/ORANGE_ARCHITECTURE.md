# Orange Belt Contract Architecture

Ship or Tip's Orange Belt upgrade separates product state from fund custody.

## Build Registry

The registry owns the lifecycle of every public commitment:

- `Building` while the deadline is active
- `Shipped` after the creator authenticates completion
- `Failed` when the deadline passes without completion

It emits `BuildCreated`, `BuildShipped`, and `BuildFailed` events.

## Tip Vault

The vault holds native XLM until the registry determines the outcome. Before accepting a deposit, release, or refund, it calls `get_build` on the registry contract. This cross-contract read is the source of truth for creator, deadline, and status.

- A backer deposits XLM while a build is active.
- A creator releases the escrow only after the registry reports `Shipped`.
- A backer claims their own contribution when the registry reports `Failed` or the deadline has passed.

It emits `TipDeposited`, `FundsReleased`, and `RefundClaimed` events.

## Trust boundaries

- Wallets sign their own creator and backer actions.
- The registry cannot move funds.
- The vault cannot change build status.
- Checks and state writes happen atomically inside each transaction.
- Refund contribution is cleared before the token transfer to prevent replay.

