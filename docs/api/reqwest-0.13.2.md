# Reqwest 0.13.2 — API Reference (fetched from Context7)

Source: docs.rs/reqwest/0.13.2 via Context7

## Client

An asynchronous `Client` to make Requests with. The `Client` holds a connection pool internally to improve performance by reusing connections and avoiding setup overhead, so it is advised that you create one and **reuse** it.

### `Client::new()`

Constructs a new `Client`.

**Panics**: This method panics if a TLS backend cannot be initialized, or the resolver cannot load the system configuration. Use `Client::builder()` if you wish to handle the failure as an `Error` instead of panicking.

### `Client::builder()`

Creates a `ClientBuilder` to configure a `Client`. This is the same as `ClientBuilder::new()`.

### Connection Pooling

The connection pool can be configured using `ClientBuilder` methods with the `pool_` prefix, such as `ClientBuilder::pool_idle_timeout` and `ClientBuilder::pool_max_idle_per_host`.

## HTTP Request Methods

- `Client::get<U: IntoUrl>(&self, url: U) -> RequestBuilder` — Convenience method to make a `GET` request
- `Client::post<U: IntoUrl>(&self, url: U) -> RequestBuilder` — Convenience method to make a `POST` request
- `Client::put<U: IntoUrl>(&self, url: U) -> RequestBuilder`
- `Client::patch<U: IntoUrl>(&self, url: U) -> RequestBuilder`
- `Client::delete<U: IntoUrl>(&self, url: U) -> RequestBuilder`
- `Client::head<U: IntoUrl>(&self, url: U) -> RequestBuilder`

**Errors**: These methods fail whenever the supplied `Url` cannot be parsed.

## Making POST Requests with a Raw Body

```rust
let client = reqwest::Client::new();
let res = client.post("http://httpbin.org/post")
    .body("the exact body that is sent")
    .send()
    .await?;
```

## Making POST Requests with JSON

```rust
// This will POST a body of `{"lang":"rust","body":"json"}`
let mut map = HashMap::new();
map.insert("lang", "rust");
map.insert("body", "json");

let client = reqwest::Client::new();
let res = client.post("http://httpbin.org/post")
    .json(&map)
    .send()
    .await?;
```

## Forms

```rust
// This will POST a body of `foo=bar&baz=quux`
let params = [("foo", "bar"), ("baz", "quux")];
let client = reqwest::Client::new();
let res = client.post("http://httpbin.org/post")
    .form(&params)
    .send()
    .await?;
```

## Redirect Policies

By default, a `Client` will automatically handle HTTP redirects, having a maximum redirect chain of 10 hops. To customize this behavior, a `redirect::Policy` can be used with a `ClientBuilder`.

### `Policy::limited(max: usize)`

Create a `Policy` with a maximum number of redirects. An `Error` will be returned if the max is reached.

### `Policy::none()`

Create a `Policy` that does not follow any redirect.

### `Policy::custom<T>(policy: T)`

Create a custom `Policy` using the passed function. The custom policy should have some way of handling redirect loops.

```rust
let custom = redirect::Policy::custom(|attempt| {
    if attempt.previous().len() > 5 {
        attempt.error("too many redirects")
    } else if attempt.url().host_str() == Some("example.domain") {
        attempt.stop()
    } else {
        attempt.follow()
    }
});
let client = reqwest::Client::builder()
    .redirect(custom)
    .build()?;
```

### LOCATION Header and Redirect Method Behavior

> The HTTP method used to make the new request to fetch the page pointed to by Location depends of the original method and of the kind of redirection:
> - **303 (See Also)** responses always lead to the use of a **GET** method
> - **307 (Temporary Redirect)** and **308 (Permanent Redirect)** **don't change the method** used in the original request
> - **301 (Permanent Redirect)** and **302 (Found)** **doesn't change the method most of the time**, though older user-agents may (so you basically don't know).

**CRITICAL: `attempt.follow()` on 301/302 CAN convert POST → GET.** This means if you POST to a URL that returns 301/302, the redirected request may become GET, which can cause 405 Method Not Allowed on servers that only accept POST.

## Client Builder Configuration

### `redirect(policy: Policy) -> ClientBuilder`

Sets a `RedirectPolicy` for the client. The default policy follows redirects up to a maximum of 10.

### `referer(enable: bool) -> ClientBuilder`

Enables or disables the automatic setting of the `Referer` header. The default is `true` (enabled).

### `user_agent(value) -> ClientBuilder`

Sets the `User-Agent` header to be used by this client.

### `default_headers(headers) -> ClientBuilder`

Sets the default headers for every request.

## Response Struct

A `Response` to a submitted `Request`.

### Methods

- **`status(&self) -> StatusCode`** — Get the StatusCode of this Response.
- **`version(&self) -> Version`** — Get the HTTP Version of this Response.
- **`headers(&self) -> &HeaderMap`** — Get the Headers of this Response.
- **`headers_mut(&mut self) -> &mut HeaderMap`** — Get a mutable reference to the Headers.
- **`content_length(&self) -> Option<u64>`** — Get the content length of the response, if known.
- **`url(&self) -> &Url`** — Get the final Url of this Response (after following redirects).
- **`remote_addr(&self) -> Option<SocketAddr>`** — Get the remote address used to get this Response.
- **`extensions(&self) -> &Extensions`** — Returns a reference to the associated extensions.
- **`extensions_mut(&mut self) -> &mut Extensions`** — Returns a mutable reference to the associated extensions.

### `text(self) -> Result<String>`

Get the full response text. This method decodes the response body with BOM sniffing and with malformed sequences replaced with the `char::REPLACEMENT_CHARACTER`. Encoding is determined from the `charset` parameter of `Content-Type` header, and defaults to utf-8 if not presented.

**Note**: If the `charset` feature is disabled, the method will only attempt to decode the response as UTF-8.

### `text_with_charset(self, default_encoding: &str) -> Result<String>`

Get the full response text given a specific encoding.

### `json<T: DeserializeOwned>(self) -> Result<T>`

Try to deserialize the response body as JSON. Requires the `json` feature.

**Errors**: This method fails whenever the response body is not in JSON format, or it cannot be properly deserialized to target type `T`. For more details please see `serde_json::from_reader`.

### `bytes(self) -> Result<Bytes>`

Get the full response body as `Bytes`.

### `chunk(&mut self) -> Result<Option<Bytes>>`

Stream a chunk of the response body. Returns `None` when the body is exhausted.

### `bytes_stream(self) -> impl Stream<Item = Result<Bytes>>`

Convert the response into a Stream of Bytes from the body. Requires the `stream` feature.

### `error_for_status(self) -> Result<Self>`

Turn a response into an error if the server returned an error.

### `error_for_status_ref(&self) -> Result<&Self>`

Turn a reference to a response into an error if the server returned an error.

### `upgrade(self) -> Result<Upgraded>`

Consumes the response and returns a future for a possible HTTP upgrade.

## Error Struct

The Errors that may occur when processing a Request.

**Note**: Errors may include the full URL used to make the Request. If the URL contains sensitive information (e.g., an API key as a query parameter), be sure to remove it (`without_url`).

### Methods

- **`url(&self) -> Option<&Url>`** — Returns a possible URL related to this error.
- **`url_mut(&mut self) -> Option<&mut Url>`** — Returns a mutable reference to the URL related to this error.
- **`with_url(self, url: Url) -> Self`** — Add a url related to this error (overwriting any existing).
- **`without_url(self) -> Self`** — Strip the related url from this error.
- **`is_builder(&self) -> bool`** — Returns true if the error is from a type Builder.
- **`is_redirect(&self) -> bool`** — Returns true if the error is from a RedirectPolicy.
- **`is_status(&self) -> bool`** — Returns true if the error is from `Response::error_for_status`.
- **`is_timeout(&self) -> bool`** — Returns true if the error is related to a timeout.
- **`is_request(&self) -> bool`** — Returns true if the error is related to the request.
- **`is_connect(&self) -> bool`** — Returns true if the error is related to connect (non-WebAssembly only).
- **`is_body(&self) -> bool`** — Returns true if the error is related to the request or response body.
- **`is_decode(&self) -> bool`** — Returns true if the error is related to decoding the response's body.
- **`status(&self) -> Option<StatusCode>`** — Returns the status code, if the error was generated from a response.
- **`is_upgrade(&self) -> bool`** — Returns true if the error is related to a protocol upgrade request.

## URL Construction

Source: docs.rs/reqwest/0.13.2/reqwest/struct.Url.html

```rust
use url::Url;

// Base without a trailing slash — path replaces last segment
let base = Url::parse("https://example.net/a/b.html")?;
let url = base.join("c.png")?;
assert_eq!(url.as_str(), "https://example.net/a/c.png");  // Not /a/b.html/c.png

// Base with a trailing slash — path joins
let base = Url::parse("https://example.net/a/b/")?;
let url = base.join("c.png")?;
assert_eq!(url.as_str(), "https://example.net/a/b/c.png");

// Input as scheme relative special URL
let base = Url::parse("https://alice.com/a")?;
let url = base.join("//eve.com/b")?;
assert_eq!(url.as_str(), "https://eve.com/b");

// Input as base url relative special URL
let base = Url::parse("https://alice.com/a")?;
let url = base.join("/v1/meta")?;
assert_eq!(url.as_str(), "https://alice.com/v1/meta");

// Input as absolute URL
let base = Url::parse("https://alice.com/a")?;
let url = base.join("http://eve.com/b")?;
assert_eq!(url.as_str(), "http://eve.com/b");  // http instead of https
```

**Note**: When constructing URLs via `format!("{}/path", host)`, if `host` has a trailing `/`, the resulting URL will have a double slash (`//path`). Some servers (including Ollama) respond to `//path` with a 301 redirect. Since 301/302 redirects may change POST to GET per HTTP spec, this can cause unexpected 405 Method Not Allowed errors.

## Feature Flags

- `http2` (enabled by default): Enables HTTP/2 support.
- `default-tls` (enabled by default): Provides TLS support to connect over HTTPS.
- `rustls`: Enables TLS functionality provided by rustls.
- `json`: Provides serialization and deserialization for JSON bodies.
- `stream`: Adds support for `futures::Stream`.