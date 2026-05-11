# Responsive Framework for Email
The Responsive Framework is a set of HTML guidelines that was designed through years of industry experience. It captures practices that help design responsive cross-client emails with minimal effort.

[This page](https://selligentmarketingcloud.github.io/ResponsiveFramework/) shows how different clients render [the source html of the framework](https://github.com/SelligentMarketingCloud/ResponsiveFramework/blob/main/source/v5.0.html). Note that the goal of the Responsive Framework is not to be W3C compliant, but to be email client safe.

# Sample layout

![GMail](https://github.com/SelligentMarketingCloud/ResponsiveFramework/raw/refs/heads/main/output/gmailcom-lm_chrcurrent_win10.png)

# Responsive Framework for Content Blocks

To be able to use the Framework in **Content Blocks** instead of using the "m_wrapper" `<div>` to contain everything it will be necessary to use it in every Content Block.

Here an example of how it should look the Content Block:

```
<!-- :: Add SL into aria-label tag -->
<div role="article" aria-roledescription="email" aria-label="" lang="en" style="background-color:#d0d5d6;" class="m_wrapper darkBg">
    <!--[if (gte mso 9)|(IE)]>
    <table width="600" align="center" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="width:600px;" role="presentation" class="darkInner">
        <tr>
            <td align="center" width="600" style="width:600px;">
                <![endif]-->
                <div style="max-width:600px; margin:0 auto; font-size:16px; background-color:#ffffff;" class="darkInner">
                    <!-- Insert here any layout of the Framework -->
                </div>
            <!--[if (gte mso 9)|(IE)]>
            </td>
        </tr>
    </table>
    <![endif]-->    
</div>
```
To keep all the styling of the Framework, you can copy/paste everything in the `<head>` in a `<sg:head>`.


# Contributions
* [Fork](https://github.com/SelligentMarketingCloud/ResponsiveFramework/fork) the repository
* Modify [latest.html](https://github.com/SelligentMarketingCloud/ResponsiveFramework/blob/main/source/latest.html)
* Create a PR and wait for us to approve the screenshot validation

# Versions
| Link                          | Description                 |
|-------------------------------|-----------------------------|
| [v4.0](/source/v4.0.html)     | Initial version for sharing |
| [v5.0](/source/v5.0.html)     | Enhancement of previous version with accessibility elements |
| [latest](/source/latest.html) | Currently the same as v5.0  |
