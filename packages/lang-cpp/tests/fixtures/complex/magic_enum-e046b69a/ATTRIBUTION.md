# Magic Enum C++ — Vendored Test Fixture

This directory contains a **read-only snapshot** of [Neargye/magic_enum](https://github.com/Neargye/magic_enum) checked in solely as a complex C++ test fixture for the `@reponova/lang-cpp` extractor.

| Property | Value |
| --- | --- |
| Upstream repository | https://github.com/Neargye/magic_enum |
| Release | [v0.9.7](https://github.com/Neargye/magic_enum/releases/tag/v0.9.7) |
| Source commit | `e046b69a3736d314fad813e159b1c192eaef92cd` |
| Upstream license | MIT — see [`LICENSE`](./LICENSE) |
| Files vendored | `include/magic_enum/*.hpp` (9 headers), `LICENSE`, `README.md` |
| Purpose | Stress test for namespace recursion, template metaprogramming, classes/structs, constexpr functions, type aliases, and `using` declarations against a real-world header-only C++ library. |
| Modifications | None — files are byte-for-byte identical to the upstream release. |

We do not distribute, modify, or republish `magic_enum`. The MIT license terms in [`LICENSE`](./LICENSE) govern the use of this snapshot.

## Why magic_enum?

`magic_enum` is a representative modern C++17 header-only library:

- 9 separate headers across one namespace (`magic_enum`) with sub-namespaces (`magic_enum::detail`, `magic_enum::bitwise_operators`, `magic_enum::containers`, `magic_enum::ostream_operators`).
- Heavy template metaprogramming surface: `template<typename E>` everywhere, partial specializations, SFINAE helpers, `constexpr` predicates.
- Mix of `struct`, `class`, `using`-aliases (`using IndexType = …`), `static constexpr` members, free templated functions.
- Doxy-style comments on the public surface.

It exercises every C++ feature the extractor cares about (namespaces, classes, templates, ctors/dtors, access modifiers, `using` directives) without pulling in megabytes of dependencies.

## Refresh procedure

```bash
git clone --depth 1 --branch v0.9.7 https://github.com/Neargye/magic_enum.git /tmp/magic_enum
cp /tmp/magic_enum/include/magic_enum/*.hpp packages/lang-cpp/tests/fixtures/complex/magic_enum-e046b69a/include/magic_enum/
cp /tmp/magic_enum/LICENSE packages/lang-cpp/tests/fixtures/complex/magic_enum-e046b69a/LICENSE
cp /tmp/magic_enum/README.md packages/lang-cpp/tests/fixtures/complex/magic_enum-e046b69a/README.md
```

When refreshing, also update the commit SHA in the directory name and the table above.
