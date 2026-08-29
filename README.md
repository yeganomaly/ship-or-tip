# Ship or Tip

A Stellar Testnet dApp for public build commitments. Builders share what they plan to ship and supporters can back the ideas they want to see completed with small XLM tips.

## Live Demo

[Open Ship or Tip](https://ship-or-tip.vercel.app)

## The Idea

Good ideas often disappear inside drafts. Ship or Tip gives builders a lightweight way to publish an idea, set a deadline, explain what they are building, and receive early support from people who want to see it shipped.

The current Yellow Belt release extends that payment flow with multi-wallet support, a deployed Soroban contract, and live contract-event synchronization.

## Yellow Belt Upgrade

Ship or Tip is being upgraded into a contract-backed multi-wallet dApp:

- Multi-wallet connection through Stellar Wallets Kit
- Freighter Mobile support through WalletConnect
- Rust/Soroban tipping contract deployed on Testnet
- Contract-backed XLM transfers and onchain build statistics
- Visible preparing, signature, pending, success, and failure states
- Typed `TipReceived` events for live synchronization

### Yellow Belt requirement map

| Requirement | Implementation | Evidence |
| --- | --- | --- |
| Multi-wallet | Stellar Wallets Kit selector with Freighter, WalletConnect, xBull, Albedo, LOBSTR, Hana, and other supported modules | Open **Connect wallet** in the live demo |
| 3 error types | Wallet unavailable, user rejection/cancel, insufficient balance, unfunded account, wrong network, RPC failure, and confirmation timeout have human-readable UI feedback | `friendlyError` and inline transaction feedback in `app/page.tsx` |
| Contract on Testnet | Rust/Soroban `ship-or-tip` contract | Contract ID below and `deployments/testnet.json` |
| Frontend contract call | The tip button invokes `tip(build_id, backer, amount)` and transfers native XLM through the contract | Verified contract-call transaction below |
| Transaction status | Preparing, wallet signature, pending, success, and failure are visible | Tip panel status UI |
| Real-time synchronization | The frontend polls Soroban RPC every 5 seconds, decodes `TIP / received`, deduplicates events, and updates XLM/backer totals without refresh | **CONTRACT EVENT STREAM · LIVE** in each build panel |

Contract ID: `CB2EJPMDG26BXUQO46BII5DZCX6OJMEKFTCY6LYYWVVBLXLXSFSPG6K7`

[View the verified contract tip](https://stellar.expert/explorer/testnet/tx/d5a0be50c47deedf938c4e5b24b68288872c980ec0fc5752f937b257349470c3)

## White Belt Features

- Connect and disconnect Freighter Mobile through WalletConnect v2
- Restore an approved wallet session
- Read and display the connected account's Testnet XLM balance
- Browse three independent public build commitments
- Select a suggested or custom XLM tip amount
- Build, sign, and submit an XLM payment on Stellar Testnet
- Display loading, rejection, failure, and success feedback
- Show the confirmed transaction hash
- Link the receipt to Stellar Expert
- Copy a shareable transaction receipt
- Responsive desktop and mobile interface

## Stellar Integration

- Network: Stellar Testnet
- Wallet integration: Stellar Wallets Kit
- Connection methods: browser wallets plus WalletConnect v2 for Freighter Mobile
- Horizon endpoint: `https://horizon-testnet.stellar.org`
- Soroban RPC endpoint: `https://soroban-testnet.stellar.org`
- Explorer: Stellar Expert Testnet
- Demo recipient: `GA2PHFIXHVIAGCI4WJVZSN7CS7KT52HRB25CG6IWR4QHKWLTOYUFJNAP`

All assets and transactions in this project are for testing only and have no real-world value.

## Tech Stack

- Next.js 16
- React 19
- TypeScript
- Stellar SDK
- Stellar Wallets Kit
- Rust / Soroban SDK
- WalletConnect v2
- Tailwind CSS
- Radix UI
- Sonner

## Run Locally

### Prerequisites

- Node.js 22 or newer
- Freighter Mobile configured for Stellar Testnet
- A WalletConnect/Reown Project ID

### Installation

```bash
git clone https://github.com/yeganomaly/ship-or-tip.git
cd ship-or-tip
npm install
npm run dev
```

Open `http://localhost:3000` in your browser.

The public WalletConnect Project ID used by the demo is included in the client code. For a fork or production deployment, replace it with your own Project ID from the Reown Dashboard.

## Test the Contract Payment Flow

1. Open Ship or Tip.
2. Select a build.
3. Click **Connect wallet**.
4. Scan the QR code with Freighter Mobile or use the mobile deep link.
5. Approve the Testnet connection.
6. Confirm that the XLM balance appears in the header.
7. Choose a tip amount.
8. Watch the UI advance through **Preparing contract call**, **Waiting for wallet signature**, and **Pending on Stellar Testnet**.
9. Approve the contract invocation in the selected wallet.
10. Check the success receipt and transaction hash.
11. Return to the build and confirm the contract event stream updates the total and recent activity without a page refresh.

## Wallet Connection and Balance

The connected Freighter wallet address and live Testnet XLM balance are displayed clearly in the header.

![Freighter wallet connected with live XLM balance](docs/wallet-connected-balance.png)

## Verified Testnet Transaction

A successful 1 XLM tip was signed with Freighter Mobile and confirmed on Stellar Testnet.

![Successful 1 XLM transaction and confirmation receipt](docs/transaction-success.png)

- Amount: `1 XLM`
- Status: `Confirmed`
- Transaction hash: `3980e1542d48e8b17aae1123608b7644279b4d7045a7eb766cd3e60ad959b982`
- [View transaction on Stellar Expert](https://stellar.expert/explorer/testnet/tx/3980e1542d48e8b17aae1123608b7644279b4d7045a7eb766cd3e60ad959b982)

## Safety

- Testnet only
- Never paste a secret key or recovery phrase into the website
- Freighter handles transaction approval and signing
- A supporter should always review the destination and amount before approving

## Builder

Built by [@yeganomaly](https://github.com/yeganomaly) for the Stellar Journey to Mastery — Yellow Belt challenge.
