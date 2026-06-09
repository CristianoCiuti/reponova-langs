/**
 * Simple greeter — single namespace, single class, exposed API.
 */
#ifndef GREETER_HPP_
#define GREETER_HPP_

#include <string>

namespace greet {

/// Friendly greeter that prepends "Hello, " to a target name.
class Greeter {
 public:
  /// Construct with a default greeting prefix.
  Greeter();

  /// Construct with a custom greeting prefix.
  explicit Greeter(std::string prefix);

  ~Greeter();

  /// Compose a greeting for `name`.
  std::string greet(const std::string& name) const;

 private:
  std::string prefix_;
};

/// Free function — quick one-shot greeting.
std::string say_hello(const std::string& name);

}  // namespace greet

#endif  // GREETER_HPP_
