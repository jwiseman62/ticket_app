"""Default knowledge base articles, inserted once on first startup."""

SEED_ARTICLES = [
    {
        "title": "Device won't power on",
        "category": "hardware",
        "summary": "Steps to try when a laptop or desktop shows no signs of life.",
        "keywords": "power, dead, won't turn on, no lights, battery, charger, boot",
        "body": (
            "If your device shows no lights, sounds, or display, work through these steps:\n\n"
            "1. Confirm the power source. Try a different wall outlet and, if you have one, "
            "a different charger or power cable known to work.\n"
            "2. Check for a charging light. If no light appears when plugged in, the charger "
            "or the charging port is the likely culprit.\n"
            "3. Perform a hard reset. Hold the power button down for 30 seconds with the "
            "charger disconnected, then reconnect power and try again.\n"
            "4. For desktops, confirm the power supply switch on the back of the tower is "
            "set to the ON position.\n"
            "5. Listen and look for partial signs of life such as fans spinning or keyboard "
            "backlights. Mention these in your ticket, since they narrow the diagnosis "
            "considerably.\n\n"
            "If none of the above helps, submit a ticket including your asset tag and any "
            "partial signs of life you noticed."
        ),
    },
    {
        "title": "Application crashes or freezes on launch",
        "category": "software",
        "summary": "First-line fixes for software that closes unexpectedly or stops responding.",
        "keywords": "crash, freeze, hang, not responding, closes, error, application, program",
        "body": (
            "Before submitting a ticket, try the following in order:\n\n"
            "1. Fully close the application, including any background processes, then reopen it.\n"
            "2. Restart your computer. This resolves a surprising share of crash issues caused "
            "by stale memory or locked files.\n"
            "3. Check for updates to both the application and your operating system.\n"
            "4. Note the exact error message. A screenshot is ideal, and you can attach one "
            "directly to your ticket.\n"
            "5. Determine whether the crash happens every time or only sometimes, and whether "
            "it is tied to a specific action such as opening a particular file.\n\n"
            "When you submit a ticket, include the application name, its version number, and "
            "the exact error text. This detail usually saves an entire round trip."
        ),
    },
    {
        "title": "Cannot connect to Wi-Fi or the network",
        "category": "network",
        "summary": "Diagnose connectivity problems before escalating to IT.",
        "keywords": "wifi, wi-fi, network, internet, offline, connection, ethernet, vpn, slow",
        "body": (
            "Work through these checks:\n\n"
            "1. Confirm whether other devices in the same area can connect. If nobody can, "
            "the issue is likely infrastructure rather than your device.\n"
            "2. Toggle Wi-Fi off and back on, then forget the network and reconnect.\n"
            "3. If you are on a wired connection, reseat the Ethernet cable at both ends and "
            "check for a link light on the port.\n"
            "4. Determine what you can and cannot reach. Being able to load internal sites but "
            "not external ones (or vice versa) points to very different causes.\n"
            "5. If you are using VPN, disconnect it and test again.\n\n"
            "Include your building and room number in your ticket, plus whether the problem "
            "affects only you or others nearby."
        ),
    },
    {
        "title": "Password reset and account lockout",
        "category": "account",
        "summary": "How to regain access to a locked or inaccessible account.",
        "keywords": "password, locked out, lockout, reset, mfa, two factor, login, access denied, sign in",
        "body": (
            "Account access issues fall into a few categories, and the fix depends on which "
            "one you are facing:\n\n"
            "**Forgotten password.** Use the self-service reset link on the sign-in page if "
            "one is available. You will need access to your registered recovery method.\n\n"
            "**Account locked after failed attempts.** Most lockouts clear automatically after "
            "a set period. Wait 15 to 30 minutes before trying again.\n\n"
            "**Multi-factor authentication problems.** If you have a new phone, your "
            "authenticator app will need to be re-enrolled. This requires IT assistance and "
            "identity verification.\n\n"
            "**Permission denied on a specific system.** This usually means your account is "
            "fine but lacks access to that resource. Name the exact system and the exact error "
            "message in your ticket.\n\n"
            "For any of these, note when you last successfully signed in."
        ),
    },
    {
        "title": "Printer not printing or showing offline",
        "category": "printer",
        "summary": "Common printer problems and how to clear them yourself.",
        "keywords": "printer, print, offline, jam, toner, queue, spooler, paper, quality",
        "body": (
            "Try these steps first:\n\n"
            "1. Check the printer's own display for an error such as a paper jam, empty tray, "
            "or low toner. Many issues are resolved right at the device.\n"
            "2. Clear the print queue on your computer, then send a single test page.\n"
            "3. Confirm whether other people can print to the same printer. If they can, the "
            "problem is with your computer's connection to it rather than the printer itself.\n"
            "4. Power cycle the printer by turning it off, waiting 30 seconds, and turning it "
            "back on.\n"
            "5. For print quality problems such as streaking or faded output, run the printer's "
            "built-in cleaning cycle from its menu.\n\n"
            "Include the printer's name and physical location in your ticket."
        ),
    },
    {
        "title": "Email not sending or receiving",
        "category": "email",
        "summary": "Troubleshoot mail delivery problems in Outlook and webmail.",
        "keywords": "email, outlook, mail, send, receive, bounce, mailbox full, sync, inbox",
        "body": (
            "First, narrow down the problem:\n\n"
            "1. Test in a second client. If webmail works but the desktop app does not, the "
            "issue is local to the app rather than your mailbox.\n"
            "2. Check whether the problem affects sending, receiving, or both. This "
            "distinction matters a great deal for diagnosis.\n"
            "3. Look for a bounce message. The text of a bounce usually states the exact "
            "reason, such as an invalid address or a full recipient mailbox.\n"
            "4. Check your mailbox storage. A full mailbox silently stops receiving new mail "
            "on many systems.\n"
            "5. In Outlook, confirm you are not in Work Offline mode, found on the Send and "
            "Receive tab.\n\n"
            "Attach a screenshot of any bounce message or error dialog to your ticket."
        ),
    },
]
