Captured 2026-10-15 from an unsigned GET to
`https://api.agents-trust.com/recommend?need=weather%20forecast&view=compact`.
HTTP 402, empty body; JSON decoded from the PAYMENT-REQUIRED header.
No payment made. The Bazaar discovery extension was omitted to keep the fixture
focused on payment interoperability. The payment-attempt extension is preserved;
its quote has expired and is used only against mocked HTTP responses. Tests
substitute the resource URL to match URLSearchParams encoding.
