# Polygon Mumbai to Amoy migration

**Date:** 2026-11-14  
**Status:** Configuration-only draft. No deployment or wallet transaction was performed.

- Polygon Amoy testnet uses chain ID 80002 and AMOY_RPC_URL.
- Polygon PoS mainnet uses chain ID 137 and POLYGON_RPC_URL.
- Mumbai chain ID 80001 is removed from this active Hardhat configuration.
- Retired Polygon public RPC fallbacks are removed; a network is unavailable until its maintained provider endpoint is explicitly configured.
- Use a dedicated testnet signer for Amoy. Keep private keys and provider credentials in the secure runtime.
- Source verification uses POLYGONSCAN_API_KEY and the Amoy explorer configuration.

This migration does not establish contract audit completion, deployment, source verification, multisig ownership, or mainnet readiness. Mainnet remains separately gated by independent review and owner approval.

References:
- https://polygon.technology/blog/polygon-pos-and-polygon-zkevm-new-testnets-for-polygon-protocols
- https://forum.polygon.technology/t/deprecation-of-polygons-public-rpc-endpoints-mainnet-amoy/22014
