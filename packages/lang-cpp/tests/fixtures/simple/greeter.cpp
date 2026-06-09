#include "greeter.hpp"

#include <utility>

namespace greet {

Greeter::Greeter() : prefix_("Hello") {}

Greeter::Greeter(std::string prefix) : prefix_(std::move(prefix)) {}

Greeter::~Greeter() = default;

std::string Greeter::greet(const std::string& name) const {
  return prefix_ + ", " + name + "!";
}

std::string say_hello(const std::string& name) {
  Greeter g;
  return g.greet(name);
}

}  // namespace greet
