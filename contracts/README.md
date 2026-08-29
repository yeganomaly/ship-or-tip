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

## Testnet deployment

- Contract ID: `CB2EJPMDG26BXUQO46BII5DZCX6OJMEKFTCY6LYYWVVBLXLXSFSPG6K7`
- XLM token contract: `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`
- Wasm hash: `3c1892d743d8ec277fd286e868b456f5eea9d1fe273a81da863652abf61391f6`
- Deploy transaction: `d25e5f9631a7408eba6320d8963b8d42b5e5e1f576d516e12b51a06c49535e8a`
- Initialize transaction: `80bbb63ccb6b0d80cf4d7fca9e3f3a1694f3ea36eee8770bd9ba6b2775077efa`
- `create_build` transaction: `07cade46e384ffeabb22965e85d3508332d9dbf3bf2db788ae484c47ff1a17f5`

The complete deployment manifest is stored in `deployments/testnet.json`. No deployer secret or seed phrase is committed to the repository.
