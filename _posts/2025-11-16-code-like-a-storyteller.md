---
layout: posts
title: "Code like a storyteller"
date: 2025-11-16 12:00:00 -0500
---

It's often touted that _code is read many more times than it is written_, so we should prioritize readability with things like meaningful variable names, keeping DRY, following the single responsibility principle etc etc.

The thing is that for most of human history, we haven't read much code at all, we've read _stories_. Compared to code, stories are much easier for us to digest. A good story can be easy to follow and gripping, giving us just the right amount of information we need at each turn to keep us going. By the end we've internalized its plot and characters by the sum of their actions and experiences. When we successfully read code, we find something similar: we internalize what it does and why by the sum of its business logic and abstractions.

<figure>
  <img src="/assets/images/hobbit-riddles.jpg" alt="Bilbo and Gollum exchange riddles in 'the Hobbit (1977)'">
  <figcaption class="image-caption">
  You wouldn't mention the contents of a character's pocket if it didn't matter to the story
  </figcaption>
</figure>

However there are some key differences between a good story and good code:

1. Code is read in a non-linear fashion, more akin to a choose your own adventure book with many branches a reader could follow. We should lay out code paths so it's easy for a reader to decide what to read next.
2. Some aspects of a compelling story, such as an unexpected twist or unreliable narrator, would make for _bad_ code. We should avoid breaking the expectations of our readers.
3. Code is generally read with a distinct purpose. "How can I extend this to do X?", "Why is this throwing an error in production?". We should lay out code paths in such a way where our readers can easily find what they're looking for.

So read-optimized code should look like a boring choose your own adventure book. Each class or function should set expectations for what a reader might find within, and then live up to them. If there's something surprising buried within a class or function, its interface should hint at that without concerning the higher level call-site with the details of that surprise. In a similar vein, we shouldn't inform the user of details that aren't relevant to the code they're reading.

Another useful part of this observation is that it can help you decide when some refactoring or abstraction might be helpful. Ask yourself _'What story does this code tell?'_ and if your answer differs greatly from what you set out to accomplish by writing it, it probably warrants some refactoring.

Let's test this out with a toy example:

```py
def charge_payment_method(payment_method_details: dict, amount: float) -> bool:
    payment_method = PaymentMethod(payment_method_details)
    is_success = payment_method.charge(amount)
    return is_success
```

So, 'What's the story of this function?' We're charging a provided payment method, and this will either succeed or fail. Since `is_success` is a bool, there's no reason to think we need to handle any exceptions or involved states for processing this payment.

Unfortunately, PaymentMethod looks like this:

```py
class PaymentMethod:
    def __init__(self, details):
        self.details = details
        # Raises when details are invalid
        self._validate_via_network_request(details)

    def charge(amount):
        response = self._charge_via_network_request(self.details, amount)
        # the statuses are: ok, failed, pending, auth_challenge_needed, expired
        return response['status'] == 'ok'
```

The original `def charge_payment_method(...)` looked okay at a glance, but it turns out it was actually hiding important details.

1. A payment method might be invalid, and it will raise an exception if it's not valid.
2. Because `charge(...)` only returns `True` / `False`, it makes the reader oblivious to various states that are possible for some payment methods.

The story the PaymentMethod interface told us was unreliable! Let's refactor it to tell the reader a more complete story instead:

```py
def charge_payment_method(payment_method_details:dict, amount:float) -> str:
    payment_method = PaymentMethod(payment_method_details)
    payment_method.raise_if_invalid()
    payment_status = payment_method.charge(amount)
    return payment_status

class PaymentMethod:
    def __init__(self, details):
        self.details = details

    def raise_if_invalid() -> None:
        self._validate_via_network_request(details)

    def charge(amount) -> str:
        response = self._charge_via_network_request(self.details, amount)
        # the statuses are: ok, failed, pending, auth_challenge_needed, expired
        return response['status']

```

Now it's at least clear that the caller is going to be responsible for a few things, handling an exception around validation, as well as different types of payment flows. If the reader needs to dig into the details of either of these things, it's now clear where they should look.

This perspective often helps me figure out how to structure code; I hope you'll find the same.
