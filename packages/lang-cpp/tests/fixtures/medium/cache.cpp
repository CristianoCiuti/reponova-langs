#include "cache.hpp"

#include <algorithm>
#include <utility>

namespace acme {
namespace cache {

CacheBase::CacheBase() = default;
CacheBase::~CacheBase() = default;

template <typename K, typename V>
Cache<K, V>::Cache(std::size_t capacity)
    : table_(capacity, Entry{K{}, V{}, false}), size_(0) {}

template <typename K, typename V>
Cache<K, V>::Cache(const Cache& other) = default;

template <typename K, typename V>
Cache<K, V>::Cache(Cache&& other) noexcept = default;

template <typename K, typename V>
Cache<K, V>::~Cache() = default;

template <typename K, typename V>
Cache<K, V>& Cache<K, V>::operator=(const Cache& rhs) = default;

template <typename K, typename V>
Cache<K, V>& Cache<K, V>::operator=(Cache&& rhs) noexcept = default;

template <typename K, typename V>
void Cache<K, V>::put(const K& key, V value) {
  for (auto& entry : table_) {
    if (entry.used && entry.key == key) {
      entry.value = std::move(value);
      return;
    }
  }
  for (auto& entry : table_) {
    if (!entry.used) {
      entry.key = key;
      entry.value = std::move(value);
      entry.used = true;
      ++size_;
      return;
    }
  }
}

template <typename K, typename V>
const V* Cache<K, V>::get(const K& key) const {
  for (const auto& entry : table_) {
    if (entry.used && entry.key == key) {
      return &entry.value;
    }
  }
  return nullptr;
}

template <typename K, typename V>
std::size_t Cache<K, V>::size() const {
  return size_;
}

template <typename K, typename V>
void Cache<K, V>::clear() {
  for (auto& entry : table_) entry.used = false;
  size_ = 0;
}

template <typename K, typename V, typename Pred>
std::size_t evict_if(Cache<K, V>& cache, Pred pred) {
  (void)cache;
  (void)pred;
  return 0;
}

template class Cache<std::string, std::string>;

}  // namespace cache
}  // namespace acme
