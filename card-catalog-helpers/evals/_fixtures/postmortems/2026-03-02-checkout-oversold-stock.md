# Checkout oversold stock during the spring sale

Severity: SEV2

## Impact

For 40 minutes, checkout accepted 1,900 orders for items that were out of stock, because inventory reads came from a cache entry up to five minutes old.

## Timeline

- 09:12 Sale starts.
- 09:31 Support reports orders for sold-out items.
- 09:52 Inventory cache flushed by hand.

## Follow-ups

- Cache inventory for far less time than product data.
