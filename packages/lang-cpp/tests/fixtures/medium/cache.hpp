/**
 * In-memory key/value cache — exercises templates, inheritance,
 * nested namespaces, access modifiers, ctors/dtors, operator
 * overloading, and `using` declarations.
 */
#ifndef CACHE_HPP_
#define CACHE_HPP_

#include <cstddef>
#include <string>
#include <vector>

namespace acme {
namespace cache {

/// Abstract base for all cache flavours.
class CacheBase {
 public:
  CacheBase();
  virtual ~CacheBase();
  virtual std::size_t size() const = 0;
  virtual void clear() = 0;
};

/// Templated key/value cache backed by an open-addressing table.
template <typename K, typename V>
class Cache : public CacheBase {
 public:
  using KeyType = K;
  using ValueType = V;

  /// Build a cache with `capacity` initial slots.
  explicit Cache(std::size_t capacity);

  /// Copy ctor (deep).
  Cache(const Cache& other);

  /// Move ctor (cheap).
  Cache(Cache&& other) noexcept;

  ~Cache() override;

  Cache& operator=(const Cache& rhs);
  Cache& operator=(Cache&& rhs) noexcept;

  /// Insert or update a key.
  void put(const K& key, V value);

  /// Look up a key — returns nullptr when absent.
  const V* get(const K& key) const;

  std::size_t size() const override;
  void clear() override;

 private:
  struct Entry {
    K key;
    V value;
    bool used;
  };

  std::vector<Entry> table_;
  std::size_t size_;
};

/// Convenience alias for the most common shape.
using StringCache = Cache<std::string, std::string>;

/// Free function — drop every key whose mapped value satisfies `pred`.
template <typename K, typename V, typename Pred>
std::size_t evict_if(Cache<K, V>& cache, Pred pred);

}  // namespace cache
}  // namespace acme

#endif  // CACHE_HPP_
