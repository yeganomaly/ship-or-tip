# Ship or Tip Contract

The Yellow Belt contract turns a public build into a verifiable onchain funding record.

## Contract flow

1. `initialize` stores the administrator and the Testnet XLM Stellar Asset Contract.
2. `create_build` registers a build ID and recipient address.
3. `tip` transfers stroops from the authenticated backer to the recipient.
4. `tip` updates the build total and unique backer count.
5. A typed `TipReceived` event lets the frontend synchronize without a page refresh.

Amounts use stroops (`1 XLM = 10,000,000 stroops`) to avoid floating-point arithmetic.

## Local commands

```bash
stellar contract build
cargo test
```

The deployment ID and verified Testnet invocation hash will be recorded here after deployment.

