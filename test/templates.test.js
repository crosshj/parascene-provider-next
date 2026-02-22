import { renderHelloFromParascene, renderCommentReceived } from "../email/templates.js";

describe("Email Templates", () => {
	describe("renderHelloFromParascene", () => {
		it("should render a valid email with subject, html, and text", () => {
			const result = renderHelloFromParascene({ recipientName: "Test User" });

			expect(result).toHaveProperty("subject");
			expect(result).toHaveProperty("html");
			expect(result).toHaveProperty("text");
			expect(result.subject).toBe("Hello from parascene");
			expect(result.html).toContain("Test User");
			expect(result.text).toContain("Test User");
		});

		it("should escape HTML in recipient name", () => {
			const result = renderHelloFromParascene({ recipientName: "<script>alert('xss')</script>" });

			expect(result.html).not.toContain("<script>");
			expect(result.html).toContain("&lt;script&gt;");
		});
	});

	describe("renderCommentReceived", () => {
		it("should render a valid email without impersonation", () => {
			const result = renderCommentReceived({
				recipientName: "Alice",
				commenterName: "Bob",
				commentText: "Great work!",
				creationTitle: "My Creation",
				creationUrl: "https://example.com/creation/1"
			});

			expect(result).toHaveProperty("subject");
			expect(result).toHaveProperty("html");
			expect(result).toHaveProperty("text");
			expect(result.subject).toContain("My Creation");
			expect(result.html).toContain("You got a comment");
			expect(result.html).toContain("Alice");
			expect(result.html).toContain("Bob");
			expect(result.html).toContain("Great work!");
		});

		it("should render impersonation bar above all email content", () => {
			const result = renderCommentReceived({
				recipientName: "Alice",
				commenterName: "Bob",
				commentText: "Great work!",
				creationTitle: "My Creation",
				impersonation: {
					originalRecipient: {
						name: "Original User",
						email: "original@example.com",
						userId: 123
					},
					reason: "Suppressed domain match (example.com)"
				}
			});

			const html = result.html;

			// Find positions of key elements
			const outerTable = html.indexOf('background:#f5f7fb; padding:24px 0');
			const mainEmailTable = html.indexOf('width="600"');
			const impersonationBar = html.toLowerCase().indexOf("delegated delivery");
			// Find the email title in the actual email content (not in preheader <title>)
			// Look for the <h1> tag rather than brittle inline styles
			const emailTitleInContent = html.indexOf("<h1");

			// Impersonation bar should exist
			expect(impersonationBar).toBeGreaterThan(-1);

			// Impersonation bar should appear before the main outer table and before the main email content
			expect(impersonationBar).toBeLessThan(outerTable);
			expect(impersonationBar).toBeLessThan(mainEmailTable);

			// Impersonation bar should be before the email title in the main content
			expect(impersonationBar).toBeLessThan(emailTitleInContent);

			// Verify impersonation bar is part of a table row
			const impersonationRowIndex = html.lastIndexOf("<tr>", impersonationBar);
			const delegatedDeliveryIndex = html.toLowerCase().indexOf("delegated delivery");
			// The delegated delivery text should be after a <tr> tag (within the impersonation table row)
			expect(delegatedDeliveryIndex).toBeGreaterThan(impersonationRowIndex);

			// Verify impersonation bar content
			expect(html).toContain("Original recipient");
			expect(html).toContain("Original User");
			expect(html).toContain("original@example.com");
			expect(html).toContain("User ID");
			expect(html).toContain("123");
			expect(html).toContain("Suppressed domain match (example.com)");
		});

		it("should have orange border on impersonation bar", () => {
			const result = renderCommentReceived({
				recipientName: "Alice",
				commenterName: "Bob",
				commentText: "Great work!",
				impersonation: {
					originalRecipient: {
						name: "Original User",
						email: "original@example.com",
						userId: 123
					},
					reason: "Test reason"
				}
			});

			// Should have the expected orange border style from the template
			expect(result.html).toContain("border-bottom:1px solid #ea580c");
			expect(result.html).not.toContain("border-bottom:1px solid #fed7aa");
		});

		it("should not render impersonation bar when impersonation is null", () => {
			const result = renderCommentReceived({
				recipientName: "Alice",
				commenterName: "Bob",
				commentText: "Great work!",
				impersonation: null
			});

			expect(result.html.toLowerCase()).not.toContain("delegated delivery");
			expect(result.html).not.toContain("Original recipient");
		});

		it("should not render impersonation bar when impersonation is undefined", () => {
			const result = renderCommentReceived({
				recipientName: "Alice",
				commenterName: "Bob",
				commentText: "Great work!"
			});

			expect(result.html.toLowerCase()).not.toContain("delegated delivery");
			expect(result.html).not.toContain("Original recipient");
		});

		it("should escape HTML in all user-provided content", () => {
			const result = renderCommentReceived({
				recipientName: "<script>alert('xss')</script>",
				commenterName: "<img src=x onerror=alert(1)>",
				commentText: "<b>Bold</b> text",
				creationTitle: "<iframe src=evil.com></iframe>",
				impersonation: {
					originalRecipient: {
						name: "<script>alert('xss')</script>",
						email: "<script>alert('xss')</script>",
						userId: 123
					},
					reason: "<script>alert('xss')</script>"
				}
			});

			// Should not contain unescaped script tags (check for <script not followed by &)
			expect(result.html).not.toMatch(/<script[^&]/i);
			expect(result.html).not.toMatch(/<iframe[^&]/i);
			// onerror= in escaped form is fine, but unescaped HTML tags with onerror= should not exist
			// The escaped version will be &lt;img src=x onerror=alert(1)&gt; which is safe
			// Check that there's no unescaped <img tag with onerror
			const unescapedImgWithOnError = result.html.match(/<img[^>]*onerror=/i);
			expect(unescapedImgWithOnError).toBeNull();

			// Should contain escaped versions
			expect(result.html).toContain("&lt;script&gt;");
			expect(result.html).toContain("&lt;iframe");
		});

		it("should truncate long comments in HTML", () => {
			const longComment = "A".repeat(1000);
			const result = renderCommentReceived({
				recipientName: "Alice",
				commenterName: "Bob",
				commentText: longComment
			});

			// Comment should be truncated (max 600 chars for HTML)
			expect(result.html.length).toBeLessThan(10000);
			expect(result.html).toContain("…");
		});

		it("should include impersonation info in text version", () => {
			const result = renderCommentReceived({
				recipientName: "Alice",
				commenterName: "Bob",
				commentText: "Great work!",
				impersonation: {
					originalRecipient: {
						name: "Original User",
						email: "original@example.com",
						userId: 456
					},
					reason: "Test reason"
				}
			});

			expect(result.text).toContain("--- Delegated delivery ---");
			expect(result.text).toContain("Original recipient: Original User");
			expect(result.text).toContain("original@example.com");
			expect(result.text).toContain("User ID: 456");
			expect(result.text).toContain("Test reason");
		});

		it("should handle missing optional fields gracefully", () => {
			const result = renderCommentReceived({
				recipientName: "Alice"
			});

			expect(result.html).toContain("Alice");
			expect(result.html).toContain("Someone"); // default commenterName
			expect(result.html).toContain("your creation"); // default creationTitle
		});
	});

	describe("HTML Structure Validation", () => {
		it("should have valid HTML structure with impersonation bar", () => {
			const result = renderCommentReceived({
				recipientName: "Test",
				commenterName: "Commenter",
				commentText: "Test comment",
				impersonation: {
					originalRecipient: {
						name: "Original",
						email: "original@test.com",
						userId: 1
					},
					reason: "Test"
				}
			});

			const html = result.html;

			// Should have DOCTYPE
			expect(html).toMatch(/^<!DOCTYPE html>/i);

			// Should have html, head, and body tags
			expect(html).toContain("<html");
			expect(html).toContain("<head");
			expect(html).toContain("<body");

			// Impersonation bar should be a table row element in the outer table
			const outerTableIndex = html.indexOf('background:#f5f7fb; padding:24px 0');
			const mainEmailTableIndex = html.indexOf('width="600"');
			const impersonationBarStart = html.indexOf("background:#fff7ed");
			const impersonationRowStart = html.lastIndexOf("<tr>", impersonationBarStart);
			const delegatedDelivery = html.toLowerCase().indexOf("delegated delivery");

			// The impersonation row should exist and contain the delegated delivery text
			expect(impersonationRowStart).toBeGreaterThan(-1);
			expect(impersonationBarStart).toBeGreaterThan(-1);
			expect(delegatedDelivery).toBeGreaterThan(-1);
			// The impersonation row should come before the bar styling
			expect(impersonationRowStart).toBeLessThan(impersonationBarStart);
			// The delegated delivery text should come after the bar styling
			expect(delegatedDelivery).toBeGreaterThan(impersonationBarStart);
			// The impersonation bar should be before the main email table (white card)
			expect(impersonationBarStart).toBeLessThan(mainEmailTableIndex);

			// Should have proper table structure for email compatibility
			expect(html).toContain('role="presentation"');
			expect(html).toContain('cellpadding="0"');
			expect(html).toContain('cellspacing="0"');
		});

		it("should verify impersonation bar appears before main content table", () => {
			const result = renderCommentReceived({
				recipientName: "Test",
				commenterName: "Commenter",
				commentText: "Test",
				impersonation: {
					originalRecipient: {
						name: "Original",
						email: "original@test.com",
						userId: 1
					},
					reason: "Test"
				}
			});

			const html = result.html;

			// Find the outer table
			const outerTableIndex = html.indexOf('background:#f5f7fb; padding:24px 0');
			expect(outerTableIndex).toBeGreaterThan(-1);

			// Find the main email table (600px white card)
			const mainEmailTableIndex = html.indexOf('width="600"');
			expect(mainEmailTableIndex).toBeGreaterThan(-1);

			// Find the impersonation bar (separate table before the outer table)
			const impersonationBarIndex = html.indexOf("background:#fff7ed");
			expect(impersonationBarIndex).toBeGreaterThan(-1);

			// Impersonation bar should be before the outer table and before the white card
			expect(impersonationBarIndex).toBeLessThan(outerTableIndex);
			expect(impersonationBarIndex).toBeLessThan(mainEmailTableIndex);

			// Find the main content (title/body) - should be inside the white card, after the card starts
			const mainContentIndex = html.indexOf('padding:32px');
			expect(mainContentIndex).toBeGreaterThan(mainEmailTableIndex);
		});
	});
});
