-- A T-SQL billing schema for SQL Server, using [bracketed] identifiers,
-- IDENTITY columns, [dbo] schema qualification, and a CREATE OR ALTER
-- PROCEDURE wrapped in BEGIN ... END. This is the T-SQL prong of the
-- medium-tier fixture.

/* Account & invoice tables */
CREATE TABLE [dbo].[Account] (
    [Id]        INT IDENTITY(1,1) NOT NULL,
    [Name]      NVARCHAR(255) NOT NULL,
    [Balance]   DECIMAL(18,2) NOT NULL DEFAULT 0,
    [CreatedAt] DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_Account PRIMARY KEY CLUSTERED ([Id])
);

CREATE TABLE [dbo].[Invoice] (
    [Id]        INT IDENTITY(1,1) NOT NULL,
    [AccountId] INT           NOT NULL,
    [Amount]    DECIMAL(18,2) NOT NULL,
    [IssuedAt]  DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    [PaidAt]    DATETIME2     NULL,
    CONSTRAINT PK_Invoice PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT FK_Invoice_Account FOREIGN KEY ([AccountId]) REFERENCES [dbo].[Account]([Id])
);

CREATE TABLE [dbo].[Payment] (
    [Id]        INT IDENTITY(1,1) NOT NULL,
    [InvoiceId] INT           NOT NULL,
    [Amount]    DECIMAL(18,2) NOT NULL,
    [PaidAt]    DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_Payment PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT FK_Payment_Invoice FOREIGN KEY ([InvoiceId]) REFERENCES [dbo].[Invoice]([Id])
);

CREATE NONCLUSTERED INDEX IX_Invoice_AccountId ON [dbo].[Invoice]([AccountId]);
CREATE NONCLUSTERED INDEX IX_Payment_InvoiceId ON [dbo].[Payment]([InvoiceId]);

CREATE VIEW [dbo].[UnpaidInvoices] AS
SELECT i.[Id]        AS InvoiceId,
       i.[AccountId],
       a.[Name]      AS AccountName,
       i.[Amount],
       i.[IssuedAt]
FROM   [dbo].[Invoice] i
JOIN   [dbo].[Account] a ON i.[AccountId] = a.[Id]
WHERE  i.[PaidAt] IS NULL;

CREATE OR ALTER PROCEDURE [dbo].[RecordPayment]
    @InvoiceId INT,
    @Amount    DECIMAL(18,2)
AS
BEGIN
    SET NOCOUNT ON;

    INSERT INTO [dbo].[Payment]([InvoiceId], [Amount], [PaidAt])
    VALUES (@InvoiceId, @Amount, SYSUTCDATETIME());

    UPDATE [dbo].[Invoice]
    SET    [PaidAt] = SYSUTCDATETIME()
    WHERE  [Id] = @InvoiceId
      AND  (SELECT SUM([Amount]) FROM [dbo].[Payment] WHERE [InvoiceId] = @InvoiceId) >=
           (SELECT [Amount] FROM [dbo].[Invoice] WHERE [Id] = @InvoiceId);

    EXEC [dbo].[NotifyAccount] @InvoiceId;
END;
